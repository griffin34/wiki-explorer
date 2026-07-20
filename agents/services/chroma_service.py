from __future__ import annotations

import asyncio
import logging

import chromadb

from config import settings

logger = logging.getLogger(__name__)


class ChromaService:
    def __init__(self) -> None:
        self._client: chromadb.HttpClient | None = None

    def _get_client(self) -> chromadb.HttpClient:
        if self._client is None:
            self._client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
            )
        return self._client

    def _collection_name(self, wiki_id: str) -> str:
        # ChromaDB names: 3–63 chars, alphanumeric / underscore / hyphen only
        safe = wiki_id.replace("-", "_")
        return f"wiki_{safe}_chunks"

    async def get_or_create_collection(self, wiki_id: str) -> chromadb.Collection:
        name = self._collection_name(wiki_id)
        return await asyncio.to_thread(
            self._get_client().get_or_create_collection,
            name,
            metadata={"hnsw:space": "cosine"},
        )

    async def upsert_chunks(
        self,
        wiki_id: str,
        ids: list[str],
        documents: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
    ) -> None:
        col = await self.get_or_create_collection(wiki_id)
        await asyncio.to_thread(
            col.upsert,
            ids=ids,
            documents=documents,
            embeddings=embeddings,
            metadatas=metadatas,
        )

    async def query_chunks(
        self,
        wiki_id: str,
        query_embedding: list[float],
        n_results: int = 10,
        where: dict | None = None,
    ) -> dict:
        col = await self.get_or_create_collection(wiki_id)
        count = await asyncio.to_thread(col.count)
        kwargs: dict = {
            "query_embeddings": [query_embedding],
            "n_results": min(n_results, count or 1),
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where
        return await asyncio.to_thread(col.query, **kwargs)

    async def get_chunks_by_source(self, wiki_id: str, source_file: str) -> dict:
        col = await self.get_or_create_collection(wiki_id)
        return await asyncio.to_thread(
            col.get,
            where={"source_file": {"$eq": source_file}},
            include=["documents", "metadatas"],
        )

    async def update_chunk_metadata(
        self, wiki_id: str, ids: list[str], metadatas: list[dict]
    ) -> None:
        col = await self.get_or_create_collection(wiki_id)
        await asyncio.to_thread(col.update, ids=ids, metadatas=metadatas)

    async def delete_collection(self, wiki_id: str) -> None:
        name = self._collection_name(wiki_id)
        try:
            await asyncio.to_thread(self._get_client().delete_collection, name)
        except Exception as exc:
            logger.warning("Could not delete collection %s: %s", name, exc)

    async def collection_count(self, wiki_id: str) -> int:
        try:
            col = await self.get_or_create_collection(wiki_id)
            return await asyncio.to_thread(col.count)
        except Exception:
            return 0

    async def check_health(self) -> bool:
        try:
            await asyncio.to_thread(self._get_client().heartbeat)
            return True
        except Exception:
            return False
