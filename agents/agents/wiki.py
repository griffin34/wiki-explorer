from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime
from pathlib import Path

import yaml

from agents.ingestion import find_content_root
from config import settings
from models.schemas import WikiConfig
from services.chroma_service import ChromaService
from services.ollama_service import OllamaService

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"[^a-z0-9-]")


def _make_slug(title: str) -> str:
    return _SLUG_RE.sub("", title.lower().replace(" ", "-"))


def _extract_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter from a Markdown string (between ``---`` delimiters)."""
    stripped = text.strip()
    if not stripped.startswith("---"):
        return {}
    parts = stripped[3:].split("---", 1)
    if not parts:
        return {}
    try:
        return yaml.safe_load(parts[0]) or {}
    except yaml.YAMLError:
        return {}


_WIKI_PAGE_SYSTEM = (
    "You are a precise knowledge management assistant. "
    "Respond ONLY with the requested Markdown. No preamble."
)

_WIKI_PAGE_PROMPT_TEMPLATE = """\
Source: {source_title} ({source_type})

{context}

Generate a wiki page in this exact format:

---
title: <descriptive title, max 8 words>
type: <one of: concept, entity, overview, analysis, source>
tags: [tag1, tag2, tag3]
sources: 1
created: {today}
---

## Summary

<2-3 sentence summary>

## Key Points

<bullet points of key facts>

## Details

<detailed content organized with ### subheadings if needed>

Use [[WikiLink]] syntax to reference related topics.
"""


class WikiAgent:
    def __init__(self, ollama: OllamaService, chroma: ChromaService) -> None:
        self._ollama = ollama
        self._chroma = chroma
        self._queue: asyncio.Queue = asyncio.Queue()
        self._processor_task: asyncio.Task | None = None
        self._active: list[dict] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        self._processor_task = asyncio.create_task(
            self._process_queue(), name="wiki-queue-processor"
        )
        logger.info("WikiAgent started")

    async def stop(self) -> None:
        if self._processor_task:
            self._processor_task.cancel()
            await asyncio.gather(self._processor_task, return_exceptions=True)
        logger.info("WikiAgent stopped")

    # ------------------------------------------------------------------
    # Queue
    # ------------------------------------------------------------------

    async def enqueue(
        self, wiki_id: str, source_file: str, wiki_config: WikiConfig
    ) -> None:
        entry = {
            "wiki_id": wiki_id,
            "source_file": source_file,
            "status": "pending",
            "queued_at": datetime.utcnow().isoformat(),
        }
        self._active.append(entry)
        await self._queue.put((wiki_id, source_file, wiki_config, entry))

    async def _process_queue(self) -> None:
        try:
            while True:
                wiki_id, source_file, wiki_config, entry = await self._queue.get()
                entry["status"] = "processing"
                try:
                    await self.generate_page(wiki_id, source_file, wiki_config)
                    entry["status"] = "done"
                except Exception as exc:
                    logger.error(
                        "WikiAgent failed to generate page for %s/%s: %s",
                        wiki_id,
                        source_file,
                        exc,
                    )
                    entry["status"] = "error"
                    entry["error"] = str(exc)
                finally:
                    self._queue.task_done()
                    # Trim active list to last 100 completed items
                    done = [e for e in self._active if e["status"] in ("done", "error")]
                    if len(done) > 100:
                        self._active = [
                            e for e in self._active if e["status"] not in ("done", "error")
                        ] + done[-100:]
        except asyncio.CancelledError:
            logger.debug("Wiki queue processor cancelled")

    # ------------------------------------------------------------------
    # Core generation
    # ------------------------------------------------------------------

    async def generate_page(
        self, wiki_id: str, source_file: str, wiki_config: WikiConfig
    ) -> None:
        # 1. Fetch all chunks for this source_file
        result = await self._chroma.get_chunks_by_source(wiki_id, source_file)
        documents: list[str] = result.get("documents") or []
        metadatas: list[dict] = result.get("metadatas") or []

        if not documents:
            raise RuntimeError(f"No chunks found for source_file={source_file!r}")

        # 2. Sort chunks by chunk_index
        paired = sorted(
            zip(documents, metadatas),
            key=lambda p: p[1].get("chunk_index", 0),
        )
        documents = [d for d, _ in paired]
        metadatas = [m for _, m in paired]

        source_title = (metadatas[0].get("title") or Path(source_file).stem) if metadatas else Path(source_file).stem
        source_type = metadatas[0].get("source_type", "unknown") if metadatas else "unknown"

        # 3. Build context up to wiki_max_context_words
        context_parts: list[str] = []
        word_count = 0
        for doc in documents:
            words = doc.split()
            if word_count + len(words) > settings.wiki_max_context_words:
                remaining = settings.wiki_max_context_words - word_count
                if remaining > 0:
                    context_parts.append(" ".join(words[:remaining]))
                break
            context_parts.append(doc)
            word_count += len(words)

        context = "\n\n".join(context_parts)

        # 4. Build prompt
        today = date.today().isoformat()
        prompt = _WIKI_PAGE_PROMPT_TEMPLATE.format(
            source_title=source_title,
            source_type=source_type,
            context=context,
            today=today,
        )

        # 5. Generate via Ollama
        response = await self._ollama.generate(prompt, system=_WIKI_PAGE_SYSTEM)

        # 6. Parse frontmatter
        frontmatter = _extract_frontmatter(response)
        title: str = str(frontmatter.get("title") or source_title)

        # 7. Build slug
        slug = _make_slug(title) or _make_slug(source_title) or "untitled"

        # 8. Find content root
        content_root = await asyncio.to_thread(find_content_root, Path(wiki_config.path))
        if content_root is None:
            raise RuntimeError(f"No content root found for wiki {wiki_id} at {wiki_config.path}")

        # 9. Write wiki page
        wiki_dir = content_root / "wiki"
        await asyncio.to_thread(wiki_dir.mkdir, parents=True, exist_ok=True)
        wiki_file = wiki_dir / f"{slug}.md"
        await asyncio.to_thread(wiki_file.write_text, response, "utf-8")
        logger.info("Wrote wiki page %s", wiki_file)

        # 10. Update index.md
        index_file = wiki_dir / "index.md"
        try:
            exists = await asyncio.to_thread(index_file.exists)
            if exists:
                existing = await asyncio.to_thread(index_file.read_text, "utf-8")
                line = f"- [[{slug}]] — {title}\n"
                if line.strip() not in existing:
                    updated = existing.rstrip("\n") + "\n" + line
                    await asyncio.to_thread(index_file.write_text, updated, "utf-8")
        except Exception as exc:
            logger.warning("Could not update index.md: %s", exc)

        # 11. Update ChromaDB metadata with wiki_page reference
        ids = [m.get("id") for m in metadatas if m.get("id")]
        # If IDs weren't included in get(), re-derive them
        if not ids:
            import hashlib
            ids = [
                hashlib.md5(f"{wiki_id}:{source_file}:{m.get('chunk_index', i)}".encode()).hexdigest()
                for i, m in enumerate(metadatas)
            ]
        updated_metadatas = [{**m, "wiki_page": slug} for m in metadatas]
        try:
            await self._chroma.update_chunk_metadata(wiki_id, ids, updated_metadatas)
        except Exception as exc:
            logger.warning("Could not update chunk metadata with wiki_page: %s", exc)

        # 12. Notify Express
        try:
            import httpx as _httpx
            async with _httpx.AsyncClient() as client:
                await client.post(
                    f"{settings.express_url}/api/ai/notify",
                    json={
                        "event": "ai:wiki:created",
                        "data": {"wikiId": wiki_id, "page": slug, "title": title},
                    },
                    timeout=5.0,
                )
        except Exception:
            pass
