from __future__ import annotations

import logging
import time
from collections import defaultdict

from config import settings
from models.schemas import SearchResponse, SearchSource
from services.chroma_service import ChromaService
from services.ollama_service import OllamaService

logger = logging.getLogger(__name__)

_RAG_PROMPT_TEMPLATE = """\
Answer the following question using ONLY the provided context excerpts.
If the answer cannot be found in the context, say so clearly.
Cite sources inline as [1], [2], etc.

Question: {query}

Context:
{numbered_excerpts}

Answer concisely using Markdown formatting.
"""

_NO_RESULTS_ANSWER = "I don't have enough information to answer that question."


class SearchAgent:
    def __init__(self, ollama: OllamaService, chroma: ChromaService) -> None:
        self._ollama = ollama
        self._chroma = chroma

    async def search(
        self, wiki_id: str, query: str, top_k: int = 10
    ) -> SearchResponse:
        start_ms = time.monotonic()

        # 1. Embed the query
        query_embedding = await self._ollama.embed(query)

        # 2. Query ChromaDB
        raw = await self._chroma.query_chunks(
            wiki_id,
            query_embedding=query_embedding,
            n_results=top_k,
        )

        # 3. Parse results
        documents: list[str] = (raw.get("documents") or [[]])[0]
        metadatas: list[dict] = (raw.get("metadatas") or [[]])[0]
        distances: list[float] = (raw.get("distances") or [[]])[0]

        logger.info(
            "Search query '%s' returned %d results, distances: %s",
            query[:50],
            len(documents),
            distances[:5] if distances else "none",
        )

        scored: list[tuple[float, str, dict]] = []
        for doc, meta, dist in zip(documents, metadatas, distances):
            score = max(0.0, 1.0 - dist)
            scored.append((score, doc, meta))

        # 4. Filter by threshold
        filtered = [
            (score, doc, meta)
            for score, doc, meta in scored
            if score >= settings.search_score_threshold
        ]

        elapsed_ms = int((time.monotonic() - start_ms) * 1000)

        # 5. No results case
        if not filtered:
            return SearchResponse(
                answer=_NO_RESULTS_ANSWER,
                sources=[],
                query_time_ms=elapsed_ms,
            )

        # 6. Deduplicate by source_file (max N per source, highest score first)
        by_source: dict[str, list[tuple[float, str, dict]]] = defaultdict(list)
        for score, doc, meta in filtered:
            by_source[meta.get("source_file", "")].append((score, doc, meta))

        deduped: list[tuple[float, str, dict]] = []
        for source_chunks in by_source.values():
            source_chunks.sort(key=lambda x: x[0], reverse=True)
            deduped.extend(source_chunks[: settings.search_max_chunks_per_source])

        # 7. Take top 5 after dedup (highest score first)
        deduped.sort(key=lambda x: x[0], reverse=True)
        top = deduped[:5]

        # 8. Build RAG prompt
        excerpts = "\n\n".join(
            f"[{i + 1}] {doc}" for i, (_, doc, _) in enumerate(top)
        )
        prompt = _RAG_PROMPT_TEMPLATE.format(query=query, numbered_excerpts=excerpts)

        # 9. Generate answer
        answer = await self._ollama.generate(prompt)

        # 10. Build SearchSource list
        sources: list[SearchSource] = []
        for score, doc, meta in top:
            excerpt = doc[:300].rstrip() + ("…" if len(doc) > 300 else "")
            sources.append(
                SearchSource(
                    title=str(meta.get("title") or meta.get("source_file") or ""),
                    file=str(meta.get("source_file") or ""),
                    wiki_page=meta.get("wiki_page") or None,
                    excerpt=excerpt,
                    score=round(score, 4),
                )
            )

        elapsed_ms = int((time.monotonic() - start_ms) * 1000)
        return SearchResponse(answer=answer, sources=sources, query_time_ms=elapsed_ms)
