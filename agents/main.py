from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from agents.ingestion import IngestionAgent
from agents.search import SearchAgent
from agents.wiki import WikiAgent
from config import settings
from models.schemas import (
    HealthStatus,
    IngestRequest,
    SearchRequest,
    WikiConfig,
    WikiGenerateRequest,
    SearchResponse,
    WikiSetupProposeRequest,
    WikiSetupProposeResponse,
    WikiSetupCreateRequest,
    WikiSetupCreateResponse,
    ProposedFolder,
)
from services.chroma_service import ChromaService
from services.markitdown_service import MarkItDownService
from services.ollama_service import OllamaService
from services import ollama_service as _ollama_module

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Service + agent singletons
# ---------------------------------------------------------------------------

ollama_svc = OllamaService()
chroma_svc = ChromaService()
markitdown_svc = MarkItDownService()

ingestion_agent = IngestionAgent(ollama_svc, chroma_svc, markitdown_svc)
wiki_agent = WikiAgent(ollama_svc, chroma_svc)
search_agent = SearchAgent(ollama_svc, chroma_svc)

# Wire wiki_agent into ingestion_agent for auto-generation after ingest
ingestion_agent.wiki_agent = wiki_agent


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting agent service...")
    await ingestion_agent.start()
    await wiki_agent.start()
    logger.info("Agent service ready on port %d", settings.agent_port)
    yield
    logger.info("Shutting down agent service...")
    await wiki_agent.stop()
    await ingestion_agent.stop()
    logger.info("Agent service stopped")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="wiki-explorer agent service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthStatus)
async def get_health() -> HealthStatus:
    ollama_ok, chroma_ok = await asyncio.gather(
        _ollama_module.check_health(),
        chroma_svc.check_health(),
    )
    statuses = (ollama_ok, chroma_ok)
    if all(statuses):
        overall = "ok"
    elif any(statuses):
        overall = "degraded"
    else:
        overall = "unavailable"

    return HealthStatus(
        status=overall,
        ollama="ok" if ollama_ok else "unavailable",
        chroma="ok" if chroma_ok else "unavailable",
        watchers=len(ingestion_agent._watchers),
        wikis=len(ingestion_agent._wiki_configs),
    )


# ---------------------------------------------------------------------------
# Wiki registration
# ---------------------------------------------------------------------------

@app.get("/wikis")
async def list_wikis() -> list[dict]:
    result = []
    for wiki_id, config in ingestion_agent._wiki_configs.items():
        chunk_count = await chroma_svc.collection_count(wiki_id)
        result.append(
            {
                "id": wiki_id,
                "name": config.name,
                "mode": "wiki" if wiki_id in ingestion_agent._watchers else "folder",
                "watcher_active": wiki_id in ingestion_agent._watchers,
                "chunk_count": chunk_count,
            }
        )
    return result


@app.post("/wikis/{wiki_id}/watch")
async def watch_wiki(wiki_id: str, wiki_config: WikiConfig) -> dict:
    if wiki_config.id != wiki_id:
        raise HTTPException(status_code=422, detail="wiki_id in path must match body id")
    await ingestion_agent.register_wiki(wiki_config, auto_reindex=True)
    return {"ok": True}


@app.delete("/wikis/{wiki_id}/watch")
async def unwatch_wiki(wiki_id: str) -> dict:
    await ingestion_agent.unregister_wiki(wiki_id, purge=False)
    return {"ok": True}


@app.delete("/wikis/{wiki_id}")
async def delete_wiki(wiki_id: str, purge: bool = Query(default=False)) -> dict:
    await ingestion_agent.unregister_wiki(wiki_id, purge=purge)
    return {"ok": True}


@app.post("/wikis/{wiki_id}/reindex")
async def reindex_wiki(wiki_id: str, include_wiki_pages: bool = Query(default=True)) -> dict:
    """Re-scan and reindex all documents in a wiki, replacing existing embeddings."""
    try:
        result = await ingestion_agent.reindex_wiki(wiki_id, include_wiki_pages=include_wiki_pages)
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

@app.post("/ingest")
async def ingest_file(req: IngestRequest) -> dict:
    file_path = Path(req.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")
    await ingestion_agent.enqueue_file(req.wiki_id, file_path)
    return {"ok": True, "queued": req.file_path}


@app.get("/ingest/queue")
async def get_ingest_queue() -> list[dict]:
    return ingestion_agent.get_queue_status()


@app.get("/ingest/history")
async def get_ingest_history() -> list[dict]:
    return ingestion_agent.get_history()


# ---------------------------------------------------------------------------
# Wiki generation
# ---------------------------------------------------------------------------

@app.post("/wiki/generate")
async def generate_wiki_page(req: WikiGenerateRequest) -> dict:
    try:
        raw = settings.vaults_file.read_text()
        data = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read vaults.json: {exc}")

    wiki_config: WikiConfig | None = None
    for w in data.get("vaults", []):
        if w["id"] == req.wiki_id:
            wiki_config = WikiConfig(**w)
            break

    if wiki_config is None:
        raise HTTPException(status_code=404, detail=f"Wiki {req.wiki_id!r} not found in vaults.json")

    await wiki_agent.generate_page(req.wiki_id, req.source_file, wiki_config)
    return {"ok": True}


@app.get("/wiki/status")
async def get_wiki_status() -> list[dict]:
    return wiki_agent._active


# ---------------------------------------------------------------------------
# Wiki Setup (create-wiki workflow)
# ---------------------------------------------------------------------------

@app.post("/wiki/propose-structure", response_model=WikiSetupProposeResponse)
async def propose_wiki_structure(req: WikiSetupProposeRequest) -> WikiSetupProposeResponse:
    """Step 1: Propose folder structure based on user's topics and source types."""
    topics_str = ", ".join(req.topics)
    sources_str = ", ".join(req.source_types)
    
    prompt = f"""I'm building a personal wiki called "{req.wiki_name}".

**Topics I care about:** {topics_str}

**What I'll drop into it:** {sources_str}

Based on this, propose 3-5 subfolders for my raw/ directory. These are buckets where source material gets organized. Keep names short, lowercase with hyphens.

Respond in this exact JSON format only, no other text:
{{
  "summary": "2-sentence description of what this wiki will cover",
  "folders": [
    {{"name": "folder-name", "description": "one-line description"}}
  ]
}}"""

    try:
        response = await ollama_svc.generate(
            prompt,
            system="You are a helpful assistant that outputs only valid JSON. No markdown, no explanation, just the JSON object."
        )
        # Parse the JSON response
        import re
        # Extract JSON from response (in case there's any extra text)
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            raise ValueError("No JSON found in response")
        data = json.loads(json_match.group())
        
        folders = [ProposedFolder(**f) for f in data.get("folders", [])]
        return WikiSetupProposeResponse(
            wiki_name=req.wiki_name,
            summary=data.get("summary", ""),
            folders=folders,
        )
    except Exception as exc:
        logger.error("Failed to propose wiki structure: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to generate structure: {exc}")


@app.post("/wiki/setup", response_model=WikiSetupCreateResponse)
async def setup_wiki(req: WikiSetupCreateRequest) -> WikiSetupCreateResponse:
    """Step 2: Create the wiki folder structure and files."""
    import hashlib
    from datetime import datetime
    
    # Generate wiki ID
    wiki_id = hashlib.md5(f"{req.wiki_name}-{datetime.utcnow().isoformat()}".encode()).hexdigest()[:8]
    
    # Create wiki folder path
    wiki_folder = Path(req.wiki_path) / req.wiki_name
    
    try:
        files_created: list[str] = []
        
        # Create base folders
        wiki_folder.mkdir(parents=True, exist_ok=True)
        (wiki_folder / "raw" / "inbox").mkdir(parents=True, exist_ok=True)
        files_created.append("raw/inbox/")
        
        # Create proposed raw subfolders
        for folder in req.folders:
            folder_path = wiki_folder / "raw" / folder.name
            folder_path.mkdir(parents=True, exist_ok=True)
            files_created.append(f"raw/{folder.name}/")
        
        # Create wiki folder structure
        for subdir in ["summaries", "people", "projects", "concepts"]:
            (wiki_folder / "wiki" / subdir).mkdir(parents=True, exist_ok=True)
            files_created.append(f"wiki/{subdir}/")
        
        # Generate wiki.md using LLM
        topics_str = ", ".join(req.topics)
        sources_str = ", ".join(req.source_types)
        folders_str = "\n".join([f"    {f.name}/  # {f.description}" for f in req.folders])
        
        wiki_md_prompt = f"""Create a wiki.md operating manual for a personal wiki called "{req.wiki_name}".

Topics: {topics_str}
Source types: {sources_str}

Folder structure in raw/:
    inbox/  # landing zone for anything new or unsorted
{folders_str}

Follow this format exactly, keeping it concise (60-80 lines):

1. Brief intro (2-3 sentences about this wiki's purpose)
2. Folder structure showing raw/ and wiki/ directories
3. Three operations: ADD, ASK, TIDY UP
4. Style guidelines

Use markdown formatting. Be practical and specific to this wiki's topics."""

        wiki_md_content = await ollama_svc.generate(
            wiki_md_prompt,
            system="You are a technical writer creating a concise operating manual for a personal wiki system."
        )
        
        # Write wiki.md
        (wiki_folder / "wiki.md").write_text(wiki_md_content)
        files_created.append("wiki.md")
        
        # Create index.md
        index_content = f"""---
title: Index
type: index
created: {datetime.utcnow().strftime('%Y-%m-%d')}
updated: {datetime.utcnow().strftime('%Y-%m-%d')}
---

# {req.wiki_name}

Master index of all wiki pages.

## Categories

- [[summaries/]] - Source summaries
- [[people/]] - People pages
- [[projects/]] - Projects and initiatives
- [[concepts/]] - Ideas and frameworks

## Recent Pages

_No pages yet. Add files to `raw/inbox/` to get started._
"""
        (wiki_folder / "wiki" / "index.md").write_text(index_content)
        files_created.append("wiki/index.md")
        
        # Create log.md
        log_content = f"""---
title: Activity Log
type: log
created: {datetime.utcnow().strftime('%Y-%m-%d')}
updated: {datetime.utcnow().strftime('%Y-%m-%d')}
---

# Activity Log

Chronological record of wiki activity.

---

**{datetime.utcnow().strftime('%Y-%m-%d')}** — Wiki created with topics: {topics_str}
"""
        (wiki_folder / "wiki" / "log.md").write_text(log_content)
        files_created.append("wiki/log.md")
        
        # Create AI assistant rules
        llm_rules = f"""This folder is a personal second-brain wiki. Read @wiki.md — it's the operating manual.

It defines:

- The folder architecture (`raw/` is immutable source material; `wiki/` is curated pages)
- The page format (YAML frontmatter + `[[wikilinks]]`)
- The three operations: **ADD** (process a file in `raw/`), **ASK** (answer from the wiki with citations), **TIDY UP** (health check)

Always follow the operating manual rather than improvising. Every wiki page must trace back to a source in `raw/`. Surface contradictions between sources — don't silently resolve them.
"""
        
        # CLAUDE.md
        (wiki_folder / "CLAUDE.md").write_text(llm_rules)
        files_created.append("CLAUDE.md")
        
        # .cursor/rules/wiki-assistant.mdc
        cursor_rules = f"""---
description: Operating rules for the {req.wiki_name} second-brain
alwaysApply: true
---

{llm_rules}"""
        (wiki_folder / ".cursor" / "rules").mkdir(parents=True, exist_ok=True)
        (wiki_folder / ".cursor" / "rules" / "wiki-assistant.mdc").write_text(cursor_rules)
        files_created.append(".cursor/rules/wiki-assistant.mdc")
        
        # .github/copilot-instructions.md
        (wiki_folder / ".github").mkdir(parents=True, exist_ok=True)
        (wiki_folder / ".github" / "copilot-instructions.md").write_text(llm_rules)
        files_created.append(".github/copilot-instructions.md")
        
        # Register the wiki in vaults.json
        try:
            raw = settings.vaults_file.read_text()
            data = json.loads(raw)
        except Exception:
            data = {"vaults": []}
        
        new_wiki = {
            "id": wiki_id,
            "name": req.wiki_name,
            "path": str(wiki_folder),
            "color": req.color,
            "createdAt": datetime.utcnow().isoformat(),
        }
        data["vaults"].append(new_wiki)
        settings.vaults_file.write_text(json.dumps(data, indent=2))
        
        # Register with the ingestion agent
        wiki_config = WikiConfig(**new_wiki)
        await ingestion_agent.register_wiki(wiki_config, auto_reindex=False)
        
        return WikiSetupCreateResponse(
            ok=True,
            wiki_id=wiki_id,
            wiki_path=str(wiki_folder),
            files_created=files_created,
        )
        
    except Exception as exc:
        logger.error("Failed to create wiki: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to create wiki: {exc}")


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@app.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest) -> SearchResponse:
    return await search_agent.search(req.wiki_id, req.query, req.top_k)


@app.get("/search/suggestions")
async def search_suggestions(
    wiki_id: str = Query(...),
    prefix: str = Query(default=""),
) -> list[str]:
    # Stub — can be implemented later
    return []


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=settings.agent_port, reload=False)
