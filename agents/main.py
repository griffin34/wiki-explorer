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

    uvicorn.run("main:app", host="0.0.0.0", port=settings.agent_port, reload=False)
