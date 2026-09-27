from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, datetime
from pathlib import Path
from typing import TypedDict

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


class ExtractedEntity(TypedDict):
    name: str
    type: str  # person, technology, project, organization, concept
    description: str
    context: str  # How they appear in the source


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

# ---------------------------------------------------------------------------
# Entity Extraction Prompts
# ---------------------------------------------------------------------------

_ENTITY_EXTRACTION_SYSTEM = (
    "You are an entity extraction assistant. Extract structured information from documents. "
    "Respond ONLY with valid JSON. No preamble, no explanation, no markdown fences."
)

_ENTITY_EXTRACTION_PROMPT = """\
Analyze this document and extract all notable entities.

Document:
{context}

Extract entities in these categories:
- people: Named individuals (not generic roles like "project manager")
- technologies: Specific tools, platforms, languages, systems (e.g., "React", "AWS", "Zebra printers")
- projects: Named initiatives, products, or work efforts
- organizations: Companies, teams, departments
- concepts: Key domain concepts, methodologies, or processes unique to this content

For each entity, provide:
- name: The exact name as it appears
- type: One of [person, technology, project, organization, concept]
- description: A brief 1-sentence description based on the document context
- context: How this entity relates to the document's main topic

Return a JSON object with this exact structure:
{{"entities": [
  {{"name": "...", "type": "...", "description": "...", "context": "..."}},
  ...
]}}

Only include entities that are clearly identifiable and significant to the document.
Do not include generic terms or common words.
"""

_ENTITY_PAGE_PROMPT = """\
Create a wiki page for this {entity_type}:

Name: {entity_name}
Description: {entity_description}
Context from source: {entity_context}
Source document: {source_title}

Generate a wiki page in this exact format:

---
title: {entity_name}
type: entity
entity_type: {entity_type}
tags: [{entity_type}, {tag_suggestions}]
sources: 1
created: {today}
---

## Overview

<1-2 sentence overview of who/what this is>

## Role & Context

<How this entity relates to the source document and project>

## Related

- [[{source_slug}]] — Source document

Use [[WikiLink]] syntax to reference related concepts.
"""

_SOURCE_PAGE_PROMPT = """\
Source: {source_title} ({source_type})

{context}

Generate a wiki page summarizing this source document. This is a SOURCE type page that captures the key information.

Format:

---
title: {source_title}
type: source
tags: [source, {source_type}]
sources: 1
created: {today}
---

## Summary

<2-3 sentence summary of the document>

## Key Information

<Bullet points of the most important facts, decisions, or information>

## People Mentioned

<List of people mentioned with their roles, using [[PersonName]] wiki links>

## Technologies & Tools

<List any technologies, tools, or systems mentioned with [[TechName]] wiki links>

## Related

<List related topics using [[WikiLink]] syntax>
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
        today = date.today().isoformat()

        # 4. Find content root first (needed for all writes)
        content_root = await asyncio.to_thread(find_content_root, Path(wiki_config.path))
        if content_root is None:
            raise RuntimeError(f"No content root found for wiki {wiki_id} at {wiki_config.path}")

        wiki_dir = content_root / "wiki"
        await asyncio.to_thread(wiki_dir.mkdir, parents=True, exist_ok=True)

        # 5. Extract entities from the content
        entities = await self._extract_entities(context)
        logger.info("Extracted %d entities from %s", len(entities), source_file)

        # 6. Generate source page
        source_slug = await self._generate_source_page(
            wiki_dir, source_title, source_type, context, today, entities
        )

        # 7. Generate entity pages for each extracted entity
        for entity in entities:
            try:
                await self._generate_entity_page(
                    wiki_dir, entity, source_title, source_slug, today
                )
            except Exception as exc:
                logger.warning("Failed to generate entity page for %s: %s", entity.get("name"), exc)

        # 8. Update index.md with source page
        index_file = wiki_dir / "index.md"
        try:
            exists = await asyncio.to_thread(index_file.exists)
            if exists:
                existing = await asyncio.to_thread(index_file.read_text, "utf-8")
                line = f"- [[{source_slug}]] — {source_title}\n"
                if line.strip() not in existing:
                    updated = existing.rstrip("\n") + "\n" + line
                    await asyncio.to_thread(index_file.write_text, updated, "utf-8")
        except Exception as exc:
            logger.warning("Could not update index.md: %s", exc)

        # 9. Update ChromaDB metadata with wiki_page reference
        ids = [m.get("id") for m in metadatas if m.get("id")]
        if not ids:
            import hashlib
            ids = [
                hashlib.md5(f"{wiki_id}:{source_file}:{m.get('chunk_index', i)}".encode()).hexdigest()
                for i, m in enumerate(metadatas)
            ]
        updated_metadatas = [{**m, "wiki_page": source_slug} for m in metadatas]
        try:
            await self._chroma.update_chunk_metadata(wiki_id, ids, updated_metadatas)
        except Exception as exc:
            logger.warning("Could not update chunk metadata with wiki_page: %s", exc)

        # 10. Notify Express
        try:
            import httpx as _httpx
            async with _httpx.AsyncClient() as client:
                await client.post(
                    f"{settings.express_url}/api/ai/notify",
                    json={
                        "event": "ai:wiki:created",
                        "data": {
                            "wikiId": wiki_id, 
                            "page": source_slug, 
                            "title": source_title,
                            "entities": [e.get("name") for e in entities],
                        },
                    },
                    timeout=5.0,
                )
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Entity Extraction
    # ------------------------------------------------------------------

    async def _extract_entities(self, context: str) -> list[ExtractedEntity]:
        """Extract entities from document content using Ollama."""
        prompt = _ENTITY_EXTRACTION_PROMPT.format(context=context[:8000])  # Limit context size
        
        try:
            response = await self._ollama.generate(prompt, system=_ENTITY_EXTRACTION_SYSTEM)
            
            # Clean up response - remove markdown fences if present
            cleaned = response.strip()
            if cleaned.startswith("```"):
                # Remove markdown code block
                lines = cleaned.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned = "\n".join(lines)
            
            data = json.loads(cleaned)
            entities = data.get("entities", [])
            
            # Validate and filter entities
            valid_entities = []
            for e in entities:
                if all(k in e for k in ["name", "type", "description", "context"]):
                    if e["type"] in ["person", "technology", "project", "organization", "concept"]:
                        valid_entities.append(e)
            
            return valid_entities
            
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("Failed to parse entity extraction response: %s", exc)
            return []

    # ------------------------------------------------------------------
    # Page Generation
    # ------------------------------------------------------------------

    async def _generate_source_page(
        self,
        wiki_dir: Path,
        source_title: str,
        source_type: str,
        context: str,
        today: str,
        entities: list[ExtractedEntity],
    ) -> str:
        """Generate the main source summary page."""
        prompt = _SOURCE_PAGE_PROMPT.format(
            source_title=source_title,
            source_type=source_type,
            context=context,
            today=today,
        )
        
        response = await self._ollama.generate(prompt, system=_WIKI_PAGE_SYSTEM)
        
        # Parse frontmatter for title
        frontmatter = _extract_frontmatter(response)
        title: str = str(frontmatter.get("title") or source_title)
        slug = _make_slug(title) or _make_slug(source_title) or "untitled"
        
        # Write the page
        wiki_file = wiki_dir / f"{slug}.md"
        await asyncio.to_thread(wiki_file.write_text, response, "utf-8")
        logger.info("Wrote source page %s", wiki_file)
        
        return slug

    async def _generate_entity_page(
        self,
        wiki_dir: Path,
        entity: ExtractedEntity,
        source_title: str,
        source_slug: str,
        today: str,
    ) -> str | None:
        """Generate or update an entity page."""
        entity_name = entity["name"]
        entity_type = entity["type"]
        slug = _make_slug(entity_name)
        
        if not slug:
            return None
        
        # Create subdirectory for entity type (e.g., wiki/people/, wiki/tech/)
        type_dirs = {
            "person": "people",
            "technology": "tech",
            "project": "projects",
            "organization": "orgs",
            "concept": "concepts",
        }
        subdir_name = type_dirs.get(entity_type, "entities")
        entity_dir = wiki_dir / subdir_name
        await asyncio.to_thread(entity_dir.mkdir, parents=True, exist_ok=True)
        
        entity_file = entity_dir / f"{slug}.md"
        
        # Check if entity page already exists
        exists = await asyncio.to_thread(entity_file.exists)
        if exists:
            # Update existing page: add this source as a reference
            try:
                existing_content = await asyncio.to_thread(entity_file.read_text, "utf-8")
                source_link = f"- [[{source_slug}]] — {source_title}"
                if source_link not in existing_content:
                    # Add to Related section if it exists
                    if "## Related" in existing_content:
                        updated = existing_content.replace(
                            "## Related\n",
                            f"## Related\n\n{source_link}\n"
                        )
                    else:
                        updated = existing_content.rstrip("\n") + f"\n\n## Related\n\n{source_link}\n"
                    await asyncio.to_thread(entity_file.write_text, updated, "utf-8")
                    logger.info("Updated entity page %s with new source", entity_file)
            except Exception as exc:
                logger.warning("Could not update entity page %s: %s", entity_file, exc)
            return slug
        
        # Generate new entity page
        # Suggest tags based on entity type and name
        tag_suggestions = f"{entity_type}"
        
        prompt = _ENTITY_PAGE_PROMPT.format(
            entity_type=entity_type,
            entity_name=entity_name,
            entity_description=entity["description"],
            entity_context=entity["context"],
            source_title=source_title,
            source_slug=source_slug,
            tag_suggestions=tag_suggestions,
            today=today,
        )
        
        response = await self._ollama.generate(prompt, system=_WIKI_PAGE_SYSTEM)
        
        await asyncio.to_thread(entity_file.write_text, response, "utf-8")
        logger.info("Wrote entity page %s", entity_file)
        
        return slug
