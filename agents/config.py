from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:8b"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_timeout: int = 120

    # ChromaDB
    chroma_host: str = "localhost"
    chroma_port: int = 8001
    chroma_embedded: bool = False  # Use PersistentClient instead of HttpClient
    chroma_path: Path = Path(__file__).parent.parent / ".chroma-data"  # Data directory for embedded mode

    # Agent service
    agent_port: int = 8000
    express_url: str = "http://localhost:3001"

    # Vaults registry — resolved relative to this file's parent at import time
    vaults_file: Path = Path(__file__).parent.parent / "data" / "vaults.json"

    @field_validator("vaults_file", mode="before")
    @classmethod
    def _coerce_vaults_file(cls, v: object) -> Path:
        return Path(v) if v else Path(__file__).parent.parent / "data" / "vaults.json"

    @field_validator("chroma_path", mode="before")
    @classmethod
    def _coerce_chroma_path(cls, v: object) -> Path:
        return Path(v) if v else Path(__file__).parent.parent / ".chroma-data"

    # Ingestion
    chunk_size: int = 400  # words per chunk (conservative for nomic-embed-text 2048 token limit)
    chunk_overlap: int = 50

    # Wiki generation
    wiki_auto_generate: bool = True
    wiki_max_context_words: int = 6000

    # Search / RAG
    search_top_k: int = 10
    search_score_threshold: float = 0.30
    search_max_chunks_per_source: int = 3


settings = Settings()
