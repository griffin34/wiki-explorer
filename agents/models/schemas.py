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
