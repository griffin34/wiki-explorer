"""
Pytest configuration and fixtures for AI agent evaluations.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

# Add agents directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.search import SearchAgent
from agents.wiki import WikiAgent
from models.schemas import SearchResponse, SearchSource, WikiConfig
from services.chroma_service import ChromaService
from services.ollama_service import OllamaService


# ============================================================================
# Configuration
# ============================================================================

def pytest_addoption(parser):
    """Add custom command-line options."""
    parser.addoption(
        "--live",
        action="store_true",
        default=False,
        help="Run with live Ollama (default: use mocked responses)",
    )
    parser.addoption(
        "--output",
        action="store",
        default=None,
        help="Output JSON file for eval results",
    )


def pytest_configure(config):
    """Configure custom markers."""
    config.addinivalue_line("markers", "eval: mark test as an evaluation test")
    config.addinivalue_line("markers", "live_only: mark test to run only with --live flag")


def pytest_collection_modifyitems(config, items):
    """Skip live_only tests unless --live is specified."""
    if config.getoption("--live"):
        return
    skip_live = pytest.mark.skip(reason="Requires --live flag")
    for item in items:
        if "live_only" in item.keywords:
            item.add_marker(skip_live)


# ============================================================================
# Sample Wiki Fixture
# ============================================================================

@dataclass
class SampleWiki:
    """Container for sample wiki test data."""
    id: str
    path: Path
    config: WikiConfig
    pages: dict[str, str] = field(default_factory=dict)
    
    def get_page_content(self, slug: str) -> str | None:
        """Get content of a page by slug."""
        page_path = self.path / f"{slug}.md"
        if page_path.exists():
            return page_path.read_text()
        return self.pages.get(slug)
    
    def list_pages(self) -> list[str]:
        """List all page slugs."""
        return [p.stem for p in self.path.glob("*.md")]


@pytest.fixture(scope="session")
def sample_wiki_source() -> Path:
    """Path to the sample wiki test data."""
    return Path(__file__).parent / "test_data" / "sample_wiki"


@pytest.fixture(scope="function")
def sample_wiki(sample_wiki_source: Path, tmp_path: Path) -> Generator[SampleWiki, None, None]:
    """Create a temporary copy of the sample wiki for testing."""
    wiki_path = tmp_path / "sample_wiki"
    shutil.copytree(sample_wiki_source, wiki_path)
    
    wiki_config = WikiConfig(
        id="test-wiki-001",
        name="Test Wiki",
        path=str(wiki_path),
        color="#89b4fa",
        createdAt=datetime.utcnow().isoformat(),
    )
    
    # Load all pages into memory
    pages = {}
    for page_file in wiki_path.glob("*.md"):
        pages[page_file.stem] = page_file.read_text()
    
    yield SampleWiki(
        id=wiki_config.id,
        path=wiki_path,
        config=wiki_config,
        pages=pages,
    )


# ============================================================================
# Mock Ollama Service
# ============================================================================

class MockOllamaService:
    """Mock Ollama service with deterministic responses for testing."""
    
    # Predefined embeddings for consistent similarity scores
    _EMBEDDING_MAP: dict[str, list[float]] = {}
    _EMBEDDING_DIM = 768
    _EMBEDDING_COUNTER = 0
    
    def __init__(self):
        self._generate_responses: dict[str, str] = {}
        self._default_response = "This is a mock response from the AI model."
        
    async def generate(self, prompt: str, system: str | None = None) -> str:
        """Generate mock response based on prompt patterns."""
        prompt_lower = prompt.lower()
        
        # Search/RAG responses
        if "answer the following question" in prompt_lower:
            return self._generate_rag_response(prompt)
        
        # Wiki generation responses
        if "generate a wiki page" in prompt_lower:
            return self._generate_wiki_page(prompt)
        
        # Edit instruction parsing
        if "editing a wiki page" in prompt_lower:
            return self._generate_edit_response(prompt)
        
        # Quality scoring
        if "rate the following" in prompt_lower or "score (1-5)" in prompt_lower:
            return "4"
        
        return self._default_response
    
    async def embed(self, text: str, max_chars: int = 3000) -> list[float]:
        """Generate deterministic embeddings based on text content."""
        # Create reproducible embedding based on text hash
        import hashlib
        text_hash = hashlib.md5(text.encode()).hexdigest()
        
        if text_hash in self._EMBEDDING_MAP:
            return self._EMBEDDING_MAP[text_hash]
        
        # Generate deterministic pseudo-random embedding
        import random
        random.seed(text_hash)
        embedding = [random.uniform(-1, 1) for _ in range(self._EMBEDDING_DIM)]
        
        # Normalize
        norm = sum(x**2 for x in embedding) ** 0.5
        embedding = [x / norm for x in embedding]
        
        self._EMBEDDING_MAP[text_hash] = embedding
        return embedding
    
    def _generate_rag_response(self, prompt: str) -> str:
        """Generate mock RAG response based on the context provided."""
        prompt_lower = prompt.lower()
        
        # Check if context is provided (has numbered excerpts)
        has_context = "[1]" in prompt or "[2]" in prompt
        
        # Check for "not enough information" scenarios (topics definitely not in context)
        out_of_scope_topics = [
            "quantum physics", "blockchain", "cryptocurrency", 
            "nuclear fusion", "space exploration"
        ]
        if any(topic in prompt_lower for topic in out_of_scope_topics):
            return "I don't have enough information to answer that question."
        
        # If no context provided, return no info message
        if not has_context and "context:" in prompt_lower:
            # Check if context section is empty
            context_start = prompt_lower.find("context:") + 8
            context_end = prompt_lower.find("answer", context_start)
            if context_end > context_start:
                context_section = prompt[context_start:context_end].strip()
                if len(context_section) < 50:  # Very short context
                    return "I don't have enough information to answer that question."
        
        # Extract question from prompt
        question = "the query"
        if "question:" in prompt_lower:
            question_start = prompt_lower.find("question:") + 9
            question_end = prompt.find("\n", question_start)
            if question_end > question_start:
                question = prompt[question_start:question_end].strip()
        
        # Generate mock answer based on question keywords
        if "vp" in question.lower() or "engineering" in question.lower():
            return "Based on the provided context [1], Jessica Chen is the VP of Engineering at Acme Analytics. She leads the engineering organization and is responsible for engineering strategy and team hiring [2]."
        
        if "dataflow" in question.lower() or "project" in question.lower():
            return "According to the context [1], DataFlow is Acme Analytics' flagship data processing platform. It enables real-time analytics for enterprise customers with sub-second latency [2]."
        
        if "revenue" in question.lower() or "q2" in question.lower():
            return "The context indicates [1] that Q2 2026 revenue reached $5.1M ARR, representing a 21% increase from Q1 [2]."
        
        if "sarah" in question.lower() or "ml" in question.lower():
            return "Based on the sources [1], Sarah Martinez is the Senior Machine Learning Engineer. She focuses on ML model development and is leading the ML initiatives for the DataFlow Platform [2]."
        
        if "team" in question.lower() or "who" in question.lower():
            return "The team structure is described in the context [1]. The engineering team includes leadership, senior engineers, and contractors [2]."
        
        # Generic response with citations
        return f"Based on the provided context [1], the answer relates to {question}. The sources indicate relevant information about this topic [2]. This demonstrates the answer is derived from the context."
    
    def _generate_wiki_page(self, prompt: str) -> str:
        """Generate mock wiki page."""
        from datetime import date
        today = date.today().isoformat()
        
        return f"""---
title: Generated Test Page
type: concept
tags: [test, generated, evaluation]
sources: 1
created: {today}
---

## Summary

This is a generated wiki page for testing purposes. It contains structured content with proper frontmatter and sections.

## Key Points

- Point one from the source material
- Point two with additional context
- Related to [[machine-learning-basics]] concepts

## Details

### Technical Details

The source document describes various technical aspects that are summarized here. See [[data-pipeline-architecture]] for related information.

### Implementation Notes

Implementation follows standard patterns as documented in the source material.
"""
    
    def _generate_edit_response(self, prompt: str) -> str:
        """Generate mock edit response (returns modified page content)."""
        # For edit responses, we need to return the modified content
        # Extract the original content and apply simple transformations
        if "jessica" in prompt.lower() and "amanda" in prompt.lower():
            # Simulate replacement edit
            return prompt.replace("Jessica Chen", "Amanda Torres (replaced Jessica Chen on 2026-07-24)")
        
        return prompt  # Return as-is if no recognized edit pattern


@pytest.fixture
def mock_ollama() -> MockOllamaService:
    """Create a mock Ollama service."""
    return MockOllamaService()


@pytest_asyncio.fixture
async def live_ollama() -> OllamaService:
    """Create a live Ollama service (requires running Ollama)."""
    service = OllamaService()
    # Verify connection
    from services.ollama_service import check_health
    if not await check_health():
        pytest.skip("Ollama not available")
    return service


@pytest.fixture
def ollama_service(request, mock_ollama):
    """Return either mock or live Ollama service based on --live flag."""
    if request.config.getoption("--live"):
        # For live mode, create real service
        return OllamaService()
    return mock_ollama


# ============================================================================
# Mock ChromaDB Service
# ============================================================================

class MockChromaService:
    """Mock ChromaDB service for deterministic testing."""
    
    def __init__(self):
        self._collections: dict[str, dict[str, Any]] = {}
    
    async def get_or_create_collection(self, wiki_id: str):
        """Get or create a mock collection."""
        name = f"wiki_{wiki_id}_chunks"
        if name not in self._collections:
            self._collections[name] = {
                "documents": [],
                "embeddings": [],
                "metadatas": [],
                "ids": [],
            }
        return MagicMock(name=name)
    
    async def upsert_chunks(
        self,
        wiki_id: str,
        ids: list[str],
        documents: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict],
    ) -> None:
        """Add chunks to the mock collection."""
        name = f"wiki_{wiki_id}_chunks"
        if name not in self._collections:
            self._collections[name] = {
                "documents": [],
                "embeddings": [],
                "metadatas": [],
                "ids": [],
            }
        
        col = self._collections[name]
        for i, id_ in enumerate(ids):
            if id_ in col["ids"]:
                idx = col["ids"].index(id_)
                col["documents"][idx] = documents[i]
                col["embeddings"][idx] = embeddings[i]
                col["metadatas"][idx] = metadatas[i]
            else:
                col["ids"].append(id_)
                col["documents"].append(documents[i])
                col["embeddings"].append(embeddings[i])
                col["metadatas"].append(metadatas[i])
    
    async def query_chunks(
        self,
        wiki_id: str,
        query_embedding: list[float],
        n_results: int = 10,
        where: dict | None = None,
    ) -> dict:
        """Query chunks with mock similarity scoring.
        
        In mocked mode, we do simple keyword matching on the query embedding
        (which encodes a hash of the original text) against document content.
        This simulates semantic search without actual embeddings.
        """
        name = f"wiki_{wiki_id}_chunks"
        if name not in self._collections:
            return {"documents": [[]], "metadatas": [[]], "distances": [[]]}
        
        col = self._collections[name]
        if not col["documents"]:
            return {"documents": [[]], "metadatas": [[]], "distances": [[]]}
        
        # In mock mode, return all documents with simulated distances
        # Sort by document index to give consistent results
        scored = []
        for i, (doc, emb, meta) in enumerate(zip(col["documents"], col["embeddings"], col["metadatas"])):
            # Simulate distance based on document position (lower = better)
            # This ensures we always return results when documents exist
            distance = 0.1 + (i * 0.02)  # Distances from 0.1 to ~0.3
            scored.append((distance, doc, meta))
        
        # Sort by simulated distance
        scored.sort(key=lambda x: x[0])
        top = scored[:n_results]
        
        return {
            "documents": [[t[1] for t in top]],
            "metadatas": [[t[2] for t in top]],
            "distances": [[t[0] for t in top]],
        }
    
    async def get_chunks_by_source(self, wiki_id: str, source_file: str) -> dict:
        """Get chunks filtered by source file."""
        name = f"wiki_{wiki_id}_chunks"
        if name not in self._collections:
            return {"documents": [], "metadatas": []}
        
        col = self._collections[name]
        docs = []
        metas = []
        for doc, meta in zip(col["documents"], col["metadatas"]):
            if meta.get("source_file") == source_file:
                docs.append(doc)
                metas.append(meta)
        
        return {"documents": docs, "metadatas": metas}
    
    async def update_chunk_metadata(
        self, wiki_id: str, ids: list[str], metadatas: list[dict]
    ) -> None:
        """Update metadata for existing chunks."""
        name = f"wiki_{wiki_id}_chunks"
        if name not in self._collections:
            return
        
        col = self._collections[name]
        for id_, meta in zip(ids, metadatas):
            if id_ in col["ids"]:
                idx = col["ids"].index(id_)
                col["metadatas"][idx] = meta
    
    async def collection_count(self, wiki_id: str) -> int:
        """Get count of documents in collection."""
        name = f"wiki_{wiki_id}_chunks"
        if name not in self._collections:
            return 0
        return len(self._collections[name]["documents"])
    
    async def check_health(self) -> bool:
        """Always return healthy for mock."""
        return True


@pytest.fixture
def mock_chroma() -> MockChromaService:
    """Create a mock ChromaDB service."""
    return MockChromaService()


@pytest_asyncio.fixture
async def live_chroma(tmp_path: Path) -> AsyncGenerator[ChromaService, None]:
    """Create a live ChromaDB service with embedded mode."""
    # Temporarily override settings for embedded mode
    import config
    original_embedded = config.settings.chroma_embedded
    original_path = config.settings.chroma_path
    
    config.settings.chroma_embedded = True
    config.settings.chroma_path = tmp_path / "chroma"
    
    service = ChromaService()
    if not await service.check_health():
        pytest.skip("ChromaDB not available")
    
    yield service
    
    # Restore settings
    config.settings.chroma_embedded = original_embedded
    config.settings.chroma_path = original_path


@pytest.fixture
def chroma_service(request, mock_chroma):
    """Return either mock or live ChromaDB based on --live flag."""
    if request.config.getoption("--live"):
        # For live mode, use embedded ChromaDB
        return ChromaService()
    return mock_chroma


# ============================================================================
# Agent Fixtures
# ============================================================================

@pytest_asyncio.fixture
async def search_agent(
    ollama_service,
    chroma_service,
    sample_wiki: SampleWiki,
) -> SearchAgent:
    """Create a search agent with the sample wiki indexed."""
    agent = SearchAgent(ollama_service, chroma_service)
    
    # Index sample wiki pages
    for slug, content in sample_wiki.pages.items():
        # Create chunks (simplified)
        chunks = _chunk_text(content, chunk_size=500, overlap=50)
        
        embeddings = [await ollama_service.embed(chunk) for chunk in chunks]
        ids = [f"{sample_wiki.id}_{slug}_{i}" for i in range(len(chunks))]
        metadatas = [
            {
                "wiki_id": sample_wiki.id,
                "source_file": f"wiki/{slug}.md",
                "chunk_index": i,
                "total_chunks": len(chunks),
                "title": slug.replace("-", " ").title(),
            }
            for i in range(len(chunks))
        ]
        
        await chroma_service.upsert_chunks(
            wiki_id=sample_wiki.id,
            ids=ids,
            documents=chunks,
            embeddings=embeddings,
            metadatas=metadatas,
        )
    
    return agent


@pytest_asyncio.fixture
async def wiki_agent(ollama_service, chroma_service) -> WikiAgent:
    """Create a wiki agent for testing."""
    return WikiAgent(ollama_service, chroma_service)


# ============================================================================
# Result Collection
# ============================================================================

@dataclass
class EvalResult:
    """Container for evaluation results."""
    test_name: str
    passed: bool
    metrics: dict[str, Any] = field(default_factory=dict)
    duration_ms: float = 0.0
    error: str | None = None


class EvalResultCollector:
    """Collects eval results for JSON output."""
    
    def __init__(self):
        self.results: list[EvalResult] = []
        self.start_time = datetime.utcnow()
    
    def add_result(self, result: EvalResult):
        self.results.append(result)
    
    def to_dict(self) -> dict:
        end_time = datetime.utcnow()
        duration = (end_time - self.start_time).total_seconds()
        
        passed = sum(1 for r in self.results if r.passed)
        failed = len(self.results) - passed
        
        # Group by suite
        suites: dict[str, list[EvalResult]] = {}
        for r in self.results:
            suite = r.test_name.split("::")[0].replace("eval_", "").replace(".py", "")
            if suite not in suites:
                suites[suite] = []
            suites[suite].append(r)
        
        return {
            "metadata": {
                "timestamp": self.start_time.isoformat() + "Z",
                "mode": "live" if os.environ.get("EVAL_LIVE") else "mocked",
                "git_commit": os.environ.get("GIT_COMMIT", "unknown"),
            },
            "summary": {
                "total_tests": len(self.results),
                "passed": passed,
                "failed": failed,
                "duration_seconds": round(duration, 2),
            },
            "suites": {
                suite: {
                    "tests": [
                        {
                            "name": r.test_name,
                            "passed": r.passed,
                            "metrics": r.metrics,
                            "duration_ms": r.duration_ms,
                            "error": r.error,
                        }
                        for r in results
                    ]
                }
                for suite, results in suites.items()
            },
        }


@pytest.fixture(scope="session")
def eval_collector() -> EvalResultCollector:
    """Session-scoped result collector."""
    return EvalResultCollector()


def pytest_sessionfinish(session, exitstatus):
    """Write results to JSON file if --output specified."""
    output_file = session.config.getoption("--output")
    if output_file:
        # Access collector from session
        collector = getattr(session, "_eval_collector", None)
        if collector:
            Path(output_file).write_text(json.dumps(collector.to_dict(), indent=2))


# ============================================================================
# Utility Functions
# ============================================================================

def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks."""
    words = text.split()
    chunks = []
    
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += chunk_size - overlap
        
        if i >= len(words):
            break
    
    return chunks if chunks else [text]


# ============================================================================
# Async Event Loop
# ============================================================================

@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()
