from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from config import settings
from models.schemas import WikiConfig
from services.chroma_service import ChromaService
from services.markitdown_service import MarkItDownService
from services.ollama_service import OllamaService

if TYPE_CHECKING:
    from agents.wiki import WikiAgent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

def find_content_root(wiki_path: Path) -> Path | None:
    """Replicate Express's findContentRoot() logic.

    Returns the directory that contains a ``raw/`` or ``wiki/`` sub-directory,
    checking the wiki root itself first, then each immediate child directory.
    """
    if (wiki_path / "raw").exists() or (wiki_path / "wiki").exists():
        return wiki_path
    try:
        for entry in wiki_path.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                if (entry / "raw").exists() or (entry / "wiki").exists():
                    return entry
    except (PermissionError, OSError):
        pass
    return None


def chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    """Paragraph-aware text chunker using word count as proxy for tokens."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current_words: list[str] = []

    for para in paragraphs:
        words = para.split()
        if len(current_words) + len(words) > chunk_size:
            if current_words:
                chunks.append(" ".join(current_words))
            # Handle oversized paragraphs
            while len(words) > chunk_size:
                chunks.append(" ".join(words[:chunk_size]))
                words = words[chunk_size - overlap:]
            current_words = list(words)
        else:
            current_words.extend(words)

    if current_words:
        chunks.append(" ".join(current_words))

    return [c for c in chunks if c.strip()]


# ---------------------------------------------------------------------------
# IngestionAgent
# ---------------------------------------------------------------------------

class IngestionAgent:
    def __init__(
        self,
        ollama: OllamaService,
        chroma: ChromaService,
        markitdown: MarkItDownService,
    ) -> None:
        self._ollama = ollama
        self._chroma = chroma
        self._markitdown = markitdown
        self._watchers: dict[str, asyncio.Task] = {}  # wiki_id → watcher task
        self._queue: asyncio.Queue = asyncio.Queue()
        self._processor_task: asyncio.Task | None = None
        self._vault_watcher_task: asyncio.Task | None = None
        self._queue_history: list[dict] = []  # recent completions
        self._active: dict[str, dict] = {}  # "{wiki_id}:{file}" → status dict
        self._wiki_configs: dict[str, WikiConfig] = {}  # wiki_id → WikiConfig
        self.wiki_agent: WikiAgent | None = None  # wired from main.py

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Load all wikis from vaults.json, start watchers, start queue processor."""
        await self._load_and_register_all_wikis()
        self._processor_task = asyncio.create_task(
            self._process_queue(), name="ingestion-queue-processor"
        )
        self._vault_watcher_task = asyncio.create_task(
            self._watch_vaults_file(), name="vaults-file-watcher"
        )
        logger.info("IngestionAgent started (%d wikis registered)", len(self._wiki_configs))

    async def stop(self) -> None:
        """Cancel all tasks cleanly."""
        if self._vault_watcher_task:
            self._vault_watcher_task.cancel()
        if self._processor_task:
            self._processor_task.cancel()
        for task in list(self._watchers.values()):
            task.cancel()
        tasks = [t for t in [self._vault_watcher_task, self._processor_task] if t]
        tasks.extend(self._watchers.values())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("IngestionAgent stopped")

    # ------------------------------------------------------------------
    # Wiki registration
    # ------------------------------------------------------------------

    async def register_wiki(self, wiki: WikiConfig, auto_reindex: bool = False) -> None:
        """Find content root; start inbox watcher if the wiki is in wiki mode.
        
        If auto_reindex=True, triggers a full reindex of existing documents.
        """
        self._wiki_configs[wiki.id] = wiki
        wiki_path = Path(wiki.path)
        content_root = await asyncio.to_thread(find_content_root, wiki_path)
        
        if content_root is None:
            logger.debug("Wiki %s (%s) is in folder mode", wiki.id, wiki.name)
        else:
            inbox = content_root / "raw" / "inbox"
            await asyncio.to_thread(inbox.mkdir, parents=True, exist_ok=True)

            if wiki.id not in self._watchers:
                task = asyncio.create_task(
                    self._watch_inbox(wiki.id, inbox),
                    name=f"inbox-watcher-{wiki.id}",
                )
                self._watchers[wiki.id] = task
                logger.info("Started inbox watcher for wiki %s at %s", wiki.id, inbox)

        # Auto-reindex when explicitly requested (new wikis added via UI/API)
        if auto_reindex:
            logger.info("Auto-reindexing wiki %s", wiki.id)
            asyncio.create_task(
                self._auto_reindex(wiki.id),
                name=f"auto-reindex-{wiki.id}",
            )

    async def _auto_reindex(self, wiki_id: str) -> None:
        """Background task to reindex a wiki after registration."""
        try:
            # Small delay to let registration complete
            await asyncio.sleep(0.5)
            result = await self.reindex_wiki(wiki_id, include_wiki_pages=True)
            logger.info("Auto-reindex complete for wiki %s: %d files queued", wiki_id, result.get("files_queued", 0))
        except Exception as exc:
            logger.error("Auto-reindex failed for wiki %s: %s", wiki_id, exc)

    async def unregister_wiki(self, wiki_id: str, purge: bool = False) -> None:
        """Cancel watcher task; optionally delete ChromaDB collection."""
        task = self._watchers.pop(wiki_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._wiki_configs.pop(wiki_id, None)
        if purge:
            await self._chroma.delete_collection(wiki_id)
            logger.info("Purged ChromaDB collection for wiki %s", wiki_id)
        logger.info("Unregistered wiki %s", wiki_id)

    async def reindex_wiki(self, wiki_id: str, include_wiki_pages: bool = True) -> dict:
        """Reindex all documents in a wiki by scanning raw/processed and optionally wiki/.
        
        Returns summary of files queued for reindex.
        """
        wiki_config = self._wiki_configs.get(wiki_id)
        if not wiki_config:
            raise ValueError(f"Wiki {wiki_id} not registered")

        wiki_path = Path(wiki_config.path)
        content_root = await asyncio.to_thread(find_content_root, wiki_path)
        
        if content_root is None:
            # Folder mode — scan all supported files in the wiki path
            files = await self._scan_folder_for_documents(wiki_path)
        else:
            # Wiki mode — scan raw/processed/** and optionally wiki/**
            files = []
            processed_dir = content_root / "raw" / "processed"
            if processed_dir.exists():
                files.extend(await self._scan_folder_for_documents(processed_dir))
            
            if include_wiki_pages:
                wiki_dir = content_root / "wiki"
                if wiki_dir.exists():
                    md_files = await asyncio.to_thread(
                        lambda: list(wiki_dir.rglob("*.md"))
                    )
                    files.extend(md_files)
        
        # Purge existing collection and recreate
        await self._chroma.delete_collection(wiki_id)
        logger.info("Purged ChromaDB collection for wiki %s before reindex", wiki_id)
        
        # Queue all files for reindexing (without moving them)
        queued = 0
        for file_path in files:
            if file_path.is_file():
                await self._queue.put((wiki_id, file_path))
                key = f"{wiki_id}:{file_path}"
                self._active[key] = {
                    "wiki_id": wiki_id,
                    "file": str(file_path),
                    "status": "pending",
                    "created_at": datetime.utcnow().isoformat(),
                    "reindex": True,  # Flag to skip file move
                }
                queued += 1
        
        logger.info("Reindex started for wiki %s: %d files queued", wiki_id, queued)
        return {"wiki_id": wiki_id, "files_queued": queued}

    async def _scan_folder_for_documents(self, folder: Path) -> list[Path]:
        """Recursively find supported document files."""
        extensions = {
            ".md", ".txt", ".pdf", ".docx", ".doc", ".pptx", ".ppt",
            ".xlsx", ".xls", ".csv", ".json", ".html", ".htm", ".xml",
            ".rst", ".rtf", ".odt", ".epub",
        }
        def scan():
            results = []
            for f in folder.rglob("*"):
                if f.is_file() and f.suffix.lower() in extensions:
                    results.append(f)
            return results
        return await asyncio.to_thread(scan)

    # ------------------------------------------------------------------
    # Queuing
    # ------------------------------------------------------------------

    async def enqueue_file(self, wiki_id: str, file_path: Path) -> None:
        key = f"{wiki_id}:{file_path}"
        self._active[key] = {
            "wiki_id": wiki_id,
            "file": str(file_path),
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
        }
        await self._queue.put((wiki_id, file_path))
        logger.info("Enqueued %s for wiki %s", file_path.name, wiki_id)

    # ------------------------------------------------------------------
    # Watchers
    # ------------------------------------------------------------------

    async def _watch_inbox(self, wiki_id: str, inbox_path: Path) -> None:
        """Async watchfiles loop — adds new/modified files to the ingest queue."""
        try:
            from watchfiles import awatch, Change

            logger.info("Watching inbox %s", inbox_path)
            async for changes in awatch(str(inbox_path)):
                for change_type, path_str in changes:
                    if change_type in (Change.added, Change.modified):
                        file_path = Path(path_str)
                        if file_path.is_file():
                            await self.enqueue_file(wiki_id, file_path)
        except asyncio.CancelledError:
            logger.debug("Inbox watcher for wiki %s cancelled", wiki_id)
        except Exception as exc:
            logger.error("Inbox watcher for wiki %s crashed: %s", wiki_id, exc)

    async def _watch_vaults_file(self) -> None:
        """Watch vaults.json for additions/removals and sync watchers accordingly."""
        try:
            from watchfiles import awatch

            logger.info("Watching vaults file %s", settings.vaults_file)
            async for _ in awatch(str(settings.vaults_file)):
                await self._sync_wiki_registrations()
        except asyncio.CancelledError:
            logger.debug("Vaults file watcher cancelled")
        except Exception as exc:
            logger.error("Vaults file watcher crashed: %s", exc)

    # ------------------------------------------------------------------
    # Queue processor
    # ------------------------------------------------------------------

    async def _process_queue(self) -> None:
        """Consumer loop — processes files from the ingest queue one at a time."""
        try:
            while True:
                wiki_id, file_path = await self._queue.get()
                key = f"{wiki_id}:{file_path}"
                if key in self._active:
                    self._active[key]["status"] = "processing"
                try:
                    await self._process_file(wiki_id, file_path)
                except Exception as exc:
                    logger.error(
                        "Unhandled error processing %s for wiki %s: %s",
                        file_path,
                        wiki_id,
                        exc,
                    )
                    if key in self._active:
                        self._active[key]["status"] = "error"
                        self._active[key]["error"] = str(exc)
                finally:
                    self._queue.task_done()
        except asyncio.CancelledError:
            logger.debug("Queue processor cancelled")

    # ------------------------------------------------------------------
    # Core ingest pipeline
    # ------------------------------------------------------------------

    async def _process_file(self, wiki_id: str, file_path: Path) -> None:
        key = f"{wiki_id}:{file_path}"

        # 1. Notify Express: ingest start
        await self._notify("ai:ingest:start", {"wikiId": wiki_id, "file": str(file_path)})

        try:
            # 2. Convert with MarkItDown (sync → thread)
            conversion = await asyncio.to_thread(self._markitdown.convert, file_path)

            # 3. Chunk the text
            chunks = chunk_text(
                conversion.text,
                chunk_size=settings.chunk_size,
                overlap=settings.chunk_overlap,
            )
            if not chunks:
                raise RuntimeError("No text content extracted from file")

            # Determine paths
            wiki_config = self._wiki_configs.get(wiki_id)
            if wiki_config:
                content_root = await asyncio.to_thread(
                    find_content_root, Path(wiki_config.path)
                )
            else:
                content_root = None

            # 4. Embed each chunk
            embeddings: list[list[float]] = []
            for chunk in chunks:
                embedding = await self._ollama.embed(chunk)
                embeddings.append(embedding)

            # 5. Compute destination path so we can store the final relative path
            #    For reindex, file is already in final location; for new files, we pre-compute dest.
            is_reindex = (self._active.get(key) or {}).get("reindex", False)
            now = datetime.utcnow()
            month_dir = now.strftime("%Y-%m")
            if content_root:
                if is_reindex:
                    # File already in place — use current path relative to content_root
                    try:
                        source_file_rel = str(file_path.relative_to(content_root))
                    except ValueError:
                        source_file_rel = file_path.name
                    processed_dir = None
                    dest_path = None
                else:
                    processed_dir = content_root / "raw" / "processed" / month_dir
                    dest_path = processed_dir / file_path.name
                    source_file_rel = str(dest_path.relative_to(content_root))
            else:
                source_file_rel = file_path.name
                processed_dir = None
                dest_path = None

            # 5a. Upsert to ChromaDB
            ids = [
                hashlib.md5(
                    f"{wiki_id}:{source_file_rel}:{i}".encode()
                ).hexdigest()
                for i in range(len(chunks))
            ]
            metadatas = [
                {
                    "source_file": source_file_rel,
                    "chunk_index": i,
                    "title": conversion.title,
                    "source_type": conversion.source_type,
                    "wiki_id": wiki_id,
                }
                for i in range(len(chunks))
            ]
            await self._chroma.upsert_chunks(
                wiki_id,
                ids=ids,
                documents=chunks,
                embeddings=embeddings,
                metadatas=metadatas,
            )

            # 6. Move file to raw/processed/YYYY-MM/ (skip if reindex or folder mode)
            if content_root and processed_dir and dest_path and not is_reindex:
                await asyncio.to_thread(processed_dir.mkdir, parents=True, exist_ok=True)
                await asyncio.to_thread(file_path.rename, dest_path)
                logger.info("Moved %s → %s", file_path.name, dest_path)

            # 7. Notify Express: ingest done
            if key in self._active:
                self._active[key]["status"] = "done"
            await self._notify(
                "ai:ingest:done",
                {
                    "wikiId": wiki_id,
                    "file": str(file_path),
                    "chunks": len(chunks),
                },
            )

            # 8. Auto-generate wiki page
            if settings.wiki_auto_generate and self.wiki_agent and wiki_config:
                await self.wiki_agent.enqueue(wiki_id, source_file_rel, wiki_config)

            # Record in history
            entry = {
                "wiki_id": wiki_id,
                "file": str(file_path),
                "status": "done",
                "chunks": len(chunks),
                "created_at": (self._active.get(key) or {}).get(
                    "created_at", now.isoformat()
                ),
                "finished_at": datetime.utcnow().isoformat(),
            }
            self._queue_history.append(entry)
            if len(self._queue_history) > 200:
                self._queue_history = self._queue_history[-200:]
            self._active.pop(key, None)

        except Exception as exc:
            logger.error("Ingest failed for %s: %s", file_path, exc)
            if key in self._active:
                self._active[key]["status"] = "error"
                self._active[key]["error"] = str(exc)
            await self._notify(
                "ai:ingest:error",
                {"wikiId": wiki_id, "file": str(file_path), "error": str(exc)},
            )
            raise

    # ------------------------------------------------------------------
    # Notify Express
    # ------------------------------------------------------------------

    async def _notify(self, event: str, data: dict) -> None:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{settings.express_url}/api/ai/notify",
                    json={"event": event, "data": data},
                    timeout=5.0,
                )
        except Exception:
            pass  # Express may not be running

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def get_queue_status(self) -> list[dict]:
        """Return list of active items (pending + processing)."""
        return list(self._active.values())

    def get_history(self) -> list[dict]:
        """Return recently completed items."""
        return list(self._queue_history)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _load_and_register_all_wikis(self) -> None:
        try:
            raw = await asyncio.to_thread(settings.vaults_file.read_text)
            data = json.loads(raw)
            wikis = data.get("vaults", [])
            for w in wikis:
                config = WikiConfig(**w)
                await self.register_wiki(config)
        except FileNotFoundError:
            logger.warning("vaults.json not found at %s", settings.vaults_file)
        except Exception as exc:
            logger.error("Failed to load vaults.json: %s", exc)

    async def _sync_wiki_registrations(self) -> None:
        """Re-read vaults.json and register/unregister wikis as needed."""
        try:
            raw = await asyncio.to_thread(settings.vaults_file.read_text)
            data = json.loads(raw)
            current_ids = {w["id"] for w in data.get("vaults", [])}
            existing_ids = set(self._wiki_configs.keys())

            # Register new wikis with auto-reindex
            for w in data.get("vaults", []):
                if w["id"] not in existing_ids:
                    await self.register_wiki(WikiConfig(**w), auto_reindex=True)

            # Unregister removed
            for removed_id in existing_ids - current_ids:
                await self.unregister_wiki(removed_id)
        except Exception as exc:
            logger.error("Failed to sync wiki registrations: %s", exc)
