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


# Edit Agent models

class EditHunk(BaseModel):
    """A single hunk of changes in a page."""
    line_start: int
    line_end: int
    before: str
    after: str


class PageChange(BaseModel):
    """Changes to a single page."""
    page: str  # e.g., "project-team.md"
    revision: int
    hunks: list[EditHunk]
    original_content: Optional[str] = None  # Full content before edit
    edited_content: Optional[str] = None  # Full content after edit


class EditPreviewRequest(BaseModel):
    """Request to preview an AI bulk edit."""
    wiki_id: str
    instruction: str


class EditPreviewResponse(BaseModel):
    """Response with proposed edit changes."""
    edit_id: str
    instruction: str
    changes: list[PageChange]
    affected_pages: list[str]
    preview_diff: str


class EditApplyRequest(BaseModel):
    """Request to apply an approved edit."""
    wiki_id: str
    edit_id: str
    selected_pages: Optional[list[str]] = None  # If None, apply all


class EditApplyResponse(BaseModel):
    """Response after applying edits."""
    edit_id: str
    applied_pages: list[str]
    revision_count: int
    changelog_recorded: bool


class ManualEditRequest(BaseModel):
    """Request to apply a manual edit to a single page."""
    content: str
    reason: Optional[str] = None


class EditHistoryRequest(BaseModel):
    """Request to get edit history."""
    wiki_id: str
    page: Optional[str] = None
    limit: int = 50


class ChangelogEntrySchema(BaseModel):
    """Schema for a changelog entry."""
    id: str
    timestamp: str
    type: str  # "ai_bulk" | "manual"
    instruction: Optional[str]
    changes: list[dict]
    affected_pages: list[str]
    user: str


# AI provider settings

class ProviderSettings(BaseModel):
    model: str


class AISettings(BaseModel):
    active_provider: str = "ollama"
    auto_fallback_to_ollama: bool = True
    providers: dict[str, ProviderSettings] = {}


class AISettingsResponse(BaseModel):
    """AISettings plus which providers currently have a key set (never the keys themselves)."""
    active_provider: str
    auto_fallback_to_ollama: bool
    providers: dict[str, ProviderSettings]
    keys_configured: dict[str, bool]


class AISettingsUpdateRequest(BaseModel):
    active_provider: str
    auto_fallback_to_ollama: bool = True
    providers: dict[str, ProviderSettings] = {}
    api_key: Optional[str] = None
    """If set, updates the in-memory key for `active_provider` for this
    session (never persisted to disk by the agent itself)."""


class ProviderKeyRequest(BaseModel):
    """Stages an API key for a cloud provider in this session so its model
    list can be fetched (i.e. the key validated) without committing to that
    provider. Never changes active_provider or persisted settings."""
    api_key: str
