from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class WikiConfig(BaseModel):
    id: str
    name: str
    path: str
    color: str = "#89b4fa"
    createdAt: str = ""


class IngestRequest(BaseModel):
    wiki_id: str
    file_path: str


class IngestQueueItem(BaseModel):
    wiki_id: str
    file: str
    status: str  # "pending" | "processing" | "done" | "error"
    error: Optional[str] = None
    wiki_page: Optional[str] = None
    created_at: str


class WikiGenerateRequest(BaseModel):
    wiki_id: str
    source_file: str


class SearchRequest(BaseModel):
    wiki_id: str
    query: str
    top_k: int = 10


class SearchSource(BaseModel):
    title: str
    file: str
    wiki_page: Optional[str] = None
    excerpt: str
    score: float


class SearchResponse(BaseModel):
    answer: str
    sources: list[SearchSource]
    query_time_ms: int


class HealthStatus(BaseModel):
    status: str  # "ok" | "degraded" | "unavailable"
    ollama: str
    chroma: str
    watchers: int
    wikis: int


# Wiki setup (create-wiki workflow)

class ProposedFolder(BaseModel):
    name: str
    description: str


class WikiSetupProposeRequest(BaseModel):
    wiki_name: str
    topics: list[str]
    source_types: list[str]


class WikiSetupProposeResponse(BaseModel):
    wiki_name: str
    summary: str
    folders: list[ProposedFolder]


class WikiSetupCreateRequest(BaseModel):
    wiki_name: str
    wiki_path: str  # Parent directory where wiki folder will be created
    topics: list[str]
    source_types: list[str]
    folders: list[ProposedFolder]
    color: str = "#89b4fa"


class WikiSetupCreateResponse(BaseModel):
    ok: bool
    wiki_id: str
    wiki_path: str
    files_created: list[str]
