# AI Agents Design — wiki-explorer

> **Status:** Draft  
> **Stack:** Ollama · Qwen3 · ChromaDB · MarkItDown  
> **Approach:** Python FastAPI agent service running alongside the existing Express + React app

---

## 1. Overview

Three autonomous agents extend wiki-explorer to automatically ingest documents, synthesize wiki pages, and answer questions via semantic search — all running locally with no external API keys required.

```
┌──────────────────────────────────────────────────────────────────┐
│                         wiki-explorer                            │
│                                                                  │
│   ┌─────────────┐      ┌──────────────────────────────────────┐ │
│   │  React UI   │◄────►│  Express Server  (port 3001)         │ │
│   │  port 5173  │      │  - Wiki REST API                     │ │
│   └─────────────┘      │  - WebSocket file watcher            │ │
│                         │  - /api/ai/* proxy routes  ◄── NEW  │ │
│                         └──────────────┬───────────────────────┘ │
│                                        │ HTTP                    │
│                         ┌──────────────▼───────────────────────┐ │
│                         │  Agent Service  (FastAPI, port 8000)  │ │
│                         │                                       │ │
│                         │  ┌─────────────────────────────────┐ │ │
│                         │  │  Ingestion Agent                │ │ │
│                         │  │  watchfiles → MarkItDown        │ │ │
│                         │  │  → chunk → embed → ChromaDB     │ │ │
│                         │  └─────────────────────────────────┘ │ │
│                         │                                       │ │
│                         │  ┌─────────────────────────────────┐ │ │
│                         │  │  Wiki Agent                     │ │ │
│                         │  │  ChromaDB chunks → Qwen3        │ │ │
│                         │  │  → synthesize wiki page → write │ │ │
│                         │  └─────────────────────────────────┘ │ │
│                         │                                       │ │
│                         │  ┌─────────────────────────────────┐ │ │
│                         │  │  Search Agent                   │ │ │
│                         │  │  query → embed → ChromaDB       │ │ │
│                         │  │  → rerank → Qwen3 RAG → answer  │ │ │
│                         │  └─────────────────────────────────┘ │ │
│                         └──────────────┬──────────────────────┘  │
└────────────────────────────────────────┼─────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────┐
              │                          │                      │
    ┌─────────▼──────────┐   ┌───────────▼───────┐   ┌────────▼──────┐
    │      Ollama         │   │     ChromaDB      │   │  Wiki Files   │
    │   port 11434        │   │    port 8001      │   │  (filesystem) │
    │                     │   │                   │   │               │
    │  qwen3:8b           │   │  collections:     │   │  raw/inbox/   │
    │  nomic-embed-text   │   │  wiki_{id}_chunks │   │  raw/processed│
    └─────────────────────┘   └───────────────────┘   │  wiki/*.md    │
                                                       └───────────────┘
```

---

## 2. Multi-Wiki Support

The app manages any number of independent wikis registered in `data/vaults.json`. Every layer of the agent system is designed around this from the start.

### 2.1 `data/vaults.json` — single source of truth

The agent service reads the same `vaults.json` file that the Express server writes. It does **not** maintain its own wiki registry.

```json
{
  "vaults": [
    { "id": "abc123", "name": "Work Brain",  "path": "/Users/jane/wikis/work",    "color": "#cba6f7" },
    { "id": "def456", "name": "Research",    "path": "/Users/jane/wikis/research", "color": "#89b4fa" }
  ]
}
```

On startup the agent service:
1. Reads all registered wikis from `vaults.json`
2. For each wiki in `wiki` mode, starts an inbox watcher
3. Begins watching `vaults.json` itself for changes so new wikis are auto-detected

### 2.2 Wiki modes

The Express server already distinguishes two wiki modes. The agent service respects the same distinction:

| Mode | Has `raw/inbox/`? | Ingestion Agent? | Wiki Agent? | Search Agent? |
|------|------------------|-----------------|-------------|---------------|
| `wiki` | Yes | Yes | Yes | Yes |
| `folder` | No | No (skipped) | No | No† |

**`folder` mode wikis are safe — nothing breaks.** On startup, when the agent service resolves a wiki's content root and finds no `raw/` directory, it simply registers no watcher and creates an empty ChromaDB collection. All API calls for that wiki return graceful "not available" responses rather than errors.

> **†** Search could be extended to `folder` mode via a **Folder Indexer** variant: scan all `.md` files in the registered path, chunk them (no MarkItDown conversion needed — they're already Markdown), embed, and store in ChromaDB. The Search Agent code itself wouldn't change; only the population source differs. This is a natural Phase 5 addition. Until then, the `/api/ai/status` endpoint reports `search: "unavailable (folder mode)"` for these wikis so the UI can hide the search panel rather than showing empty results.

### 2.3 Content root resolution

The registered `path` in `vaults.json` may point to a parent folder — the actual `raw/` and `wiki/` directories can live one level deeper (e.g. `<path>/<wiki-name>/raw/`). The agent service replicates the same `findContentRoot()` logic used by the Express server:

```
path/                    ← registered path
  wiki-name/             ← actual content root (one level down)
    raw/
      inbox/             ← Ingestion Agent watches here
      processed/
    wiki/
      index.md
```

### 2.4 Watcher lifecycle

The `IngestionAgent` maintains a watcher map: `{ wiki_id → WatcherHandle }`.

```
                 vaults.json change detected
                          │
          ┌───────────────┼───────────────────┐
          ▼               ▼                   ▼
     wiki added      wiki removed       path changed
          │               │                   │
   start watcher    stop watcher +      stop old watcher
   create ChromaDB  (optionally          start new watcher
   collection       purge collection)    re-index inbox
```

The Express server **also** calls `POST /wikis/{id}/watch` and `DELETE /wikis/{id}/watch` when it adds/removes a wiki, giving immediate response rather than waiting for the `vaults.json` file-change event.

### 2.5 ChromaDB isolation

Each wiki gets its own ChromaDB collection: `wiki_{id}_chunks`.

- Queries always filter by `wiki_id` — no cross-contamination between wikis
- Deleting a wiki optionally purges its collection (`DELETE /wikis/{id}?purge=true`)
- A future "cross-wiki search" mode could query multiple collections and merge results

### 2.6 Search scoping

All ChromaDB queries include a hard `where` filter:

```python
collection.query(
    query_embeddings=[embedding],
    where={"wiki_id": {"$eq": wiki_id}},   # enforced — never optional
    n_results=top_k
)
```

This means a user browsing Wiki A in the UI can only search Wiki A's content, even though the agent service knows about all wikis.

---

## 3. Agents

### 3.1 Ingestion Agent

**Responsibility:** Watch `raw/inbox/` for new files across **all** registered wikis, convert them to Markdown, chunk, embed, and store in ChromaDB.

**Trigger:** File creation event in any active wiki's `raw/inbox/` directory (one `watchfiles` watcher per wiki).

**Pipeline:**

```
raw/inbox/document.pdf
    │
    ▼
MarkItDown.convert(file)
    → Markdown text + metadata (title, author, date)
    │
    ▼
Chunker (512 tokens, 64-token overlap, paragraph-aware)
    → List[Chunk { text, index, total }]
    │
    ▼
Ollama embeddings  (nomic-embed-text)
    → List[float[768]]
    │
    ▼
ChromaDB upsert into wiki_{id}_chunks
    → { id, embedding, document, metadata }
    │
    ▼
Move file: raw/inbox/ → raw/processed/YYYY-MM/
    │
    ▼
Emit event → Wiki Agent queue
    │
    ▼
WebSocket notification → UI (status update)
```

**Supported file types via MarkItDown:**
- Documents: `.pdf`, `.docx`, `.pptx`, `.xlsx`
- Web: `.html`, `.htm`
- Text: `.txt`, `.md`, `.csv`
- Images: `.png`, `.jpg`, `.jpeg`, `.webp` (via Ollama vision)
- Audio: `.mp3`, `.wav` (via Whisper/Ollama)

**ChromaDB document schema:**

```json
{
  "id": "wiki_abc123_doc-uuid_chunk_0",
  "embedding": [ ... 768 floats ... ],
  "document": "chunk text content...",
  "metadata": {
    "wiki_id": "abc123",
    "source_file": "raw/inbox/document.pdf",
    "source_type": "pdf",
    "source_title": "Document Title",
    "chunk_index": 0,
    "total_chunks": 12,
    "ingested_at": "2026-07-20T10:00:00Z",
    "wiki_page": null
  }
}
```

---

### 3.2 Wiki Agent

**Responsibility:** Synthesize structured wiki pages from ingested document chunks using Qwen3.

**Trigger:**
- Automatic — after Ingestion Agent completes a document
- Manual — via `POST /wiki/generate` API

**Pipeline:**

```
ChromaDB: fetch all chunks for source_file
    │
    ▼
Build context window (ordered chunks, up to 8k tokens)
    │
    ▼
Qwen3 prompt: "Given these source excerpts, generate a wiki page..."
    → Structured Markdown output with frontmatter
    │
    ▼
Parse frontmatter: title, type, tags, links, summary
    │
    ▼
Resolve wikilinks: check existing wiki/*.md, create stubs if needed
    │
    ▼
Write: wiki/{slug}.md
    │
    ▼
Update: wiki/index.md (add to page registry)
    │
    ▼
Update ChromaDB metadata: set wiki_page field on all source chunks
    │
    ▼
WebSocket notification → UI (new page available)
```

**Qwen3 wiki page prompt template:**

```
You are a personal knowledge management assistant. Generate a structured 
wiki page from the following source excerpts.

Source file: {source_title}
Source type: {source_type}

Excerpts:
{context}

Generate a wiki page in Markdown with this frontmatter:
---
title: <concise descriptive title>
type: <concept|entity|overview|analysis|source>
tags: [<3-5 relevant tags>]
sources: 1
links: [<[[WikiPage]] links to related concepts>]
created: {date}
---

Then write the page body. Be concise and factual. Use ## sections.
Use [[WikiLink]] syntax to reference related concepts.
```

**Page types generated:**
- `concept` — abstract ideas, methodologies, frameworks
- `entity` — people, organizations, products
- `overview` — summaries of documents or topics
- `analysis` — insights, conclusions, comparisons
- `source` — direct reference page for a raw document

---

### 3.3 Search Agent

**Responsibility:** Answer questions by combining semantic search over ChromaDB with Qwen3 RAG synthesis.

**Trigger:** `POST /search` API call from the UI.

**Pipeline:**

```
User query: "What did the Q3 report say about margins?"
    │
    ▼
Ollama embed query  (nomic-embed-text)
    → float[768]
    │
    ▼
ChromaDB query  (top-10, filtered by wiki_id)
    → List[Result { text, score, metadata }]
    │
    ▼
Score threshold filter  (cosine similarity > 0.6)
    │
    ▼
Deduplicate by source_file  (max 3 chunks per file)
    │
    ▼
Build RAG context  (top-5 results, with source attribution)
    │
    ▼
Qwen3 RAG prompt:
  "Answer the question using only the provided context.
   Cite sources with [1], [2] notation."
    │
    ▼
Return:
  {
    answer: "...",
    sources: [
      { title, file, wiki_page, excerpt, score }
    ],
    query_time_ms: 230
  }
```

**Qwen3 RAG prompt template:**

```
Answer the following question using ONLY the provided context excerpts.
If the answer is not in the context, say "I don't have enough information."
Cite sources inline using [1], [2] etc. notation.

Question: {query}

Context:
[1] {source_1_title}: {excerpt_1}
[2] {source_2_title}: {excerpt_2}
...

Answer concisely. Use markdown formatting.
```

---

## 4. File & Folder Structure

```
wiki-explorer/
│
├── agents/                          NEW: Python agent service
│   ├── main.py                      FastAPI app + lifespan (watchers)
│   ├── config.py                    Settings via env vars
│   ├── requirements.txt             Python dependencies
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── ingestion.py             Ingestion Agent
│   │   ├── wiki.py                  Wiki Agent
│   │   └── search.py                Search Agent
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── chroma_service.py        ChromaDB CRUD + collection management
│   │   ├── ollama_service.py        Generate + embed via Ollama REST
│   │   └── markitdown_service.py    Document → Markdown conversion
│   │
│   └── models/
│       ├── __init__.py
│       └── schemas.py               Pydantic request/response models
│
├── server/
│   └── index.ts                     ADD: /api/ai/* proxy routes
│
└── src/
    └── components/
        ├── AISearch.tsx             NEW: Chat-style search panel
        └── IngestStatus.tsx         NEW: Ingestion queue badge/drawer
```

---

## 5. API Reference

### Agent Service (FastAPI · port 8000)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Status of Ollama, ChromaDB, active watchers |
| `GET` | `/wikis` | List all wikis + their watcher/collection status |
| `POST` | `/wikis/{id}/watch` | Register wiki + start inbox watcher |
| `DELETE` | `/wikis/{id}/watch` | Stop watcher |
| `DELETE` | `/wikis/{id}` | Stop watcher + optionally purge ChromaDB collection (`?purge=true`) |
| `POST` | `/ingest` | Manually ingest a file `{ wiki_id, file_path }` |
| `GET` | `/ingest/queue` | Current queue across all wikis `[{ wiki_id, file, status, progress }]` |
| `GET` | `/ingest/history` | Past ingestions `[{ wiki_id, file, chunks, wiki_page, ts }]` |
| `POST` | `/wiki/generate` | Generate wiki page `{ wiki_id, source_file }` |
| `GET` | `/wiki/status` | Wiki generation queue across all wikis |
| `POST` | `/search` | Semantic search + Q&A `{ wiki_id, query, top_k? }` |
| `GET` | `/search/suggestions` | Query autocomplete `{ wiki_id, prefix }` |

### Express Server — new proxy routes

The Express server adds a thin proxy layer and handles wiki lifecycle events:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai/status` | Health check (proxied + formatted) |
| `POST` | `/api/ai/search` | Proxy to `/search` |
| `POST` | `/api/ai/ingest` | Proxy to `/ingest` |
| `GET` | `/api/ai/queue` | Proxy to `/ingest/queue` |
| `POST` | `/api/ai/wiki/generate` | Proxy to `/wiki/generate` |

The **existing** wiki create/delete routes in Express are updated to also call the agent service:

| Existing route | New side-effect |
|---|---|
| `POST /api/wikis` (create wiki) | → calls `POST /wikis/{id}/watch` on agent service |
| `DELETE /api/wikis/:id` (remove wiki) | → calls `DELETE /wikis/{id}` on agent service |

---

## 6. Configuration

All agent configuration via `.env` or environment variables:

```env
# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_TIMEOUT=120

# ChromaDB  
CHROMA_HOST=localhost
CHROMA_PORT=8001

# Agent service
AGENT_PORT=8000
VAULTS_FILE=../data/vaults.json  # path to wiki-explorer's vaults registry

# Ingestion
CHUNK_SIZE=512
CHUNK_OVERLAP=64
INBOX_POLL_INTERVAL=2           # seconds between inbox scans

# Wiki generation
WIKI_AUTO_GENERATE=true         # auto-run Wiki Agent after ingestion
WIKI_MAX_CONTEXT_TOKENS=8192

# Search
SEARCH_TOP_K=10
SEARCH_SCORE_THRESHOLD=0.6
SEARCH_MAX_CHUNKS_PER_SOURCE=3
```

---

## 7. New UI Components

### `AISearch` — chat-style search panel

A slide-in panel (or dedicated route `/wiki/:id/search`) with:
- Text input for natural language questions
- Streamed answer display (Qwen3 streams tokens)
- Source cards showing excerpt + link to wiki page
- Search history for the session

### `IngestStatus` — live ingestion indicator

A badge in the Layout sidebar showing:
- Idle / Watching / Processing N files
- Expandable drawer with queue items and progress
- Toast notifications when new wiki pages are created

---

## 8. Models

| Model | Purpose | Size | Pull command |
|-------|---------|------|-------------|
| `qwen3:8b` | Text generation (wiki + Q&A) | ~5 GB | `ollama pull qwen3:8b` |
| `nomic-embed-text` | Embeddings (768 dims) | ~274 MB | `ollama pull nomic-embed-text` |

Upgrade path: swap `qwen3:8b` for `qwen3:14b` or `qwen3:32b` for higher quality on capable hardware.

---

## 9. Python Dependencies

```txt
# agents/requirements.txt
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
pydantic>=2.7.0
pydantic-settings>=2.2.0

# Document ingestion
markitdown[all]>=0.0.1

# Vector DB
chromadb>=0.5.0

# Ollama client
ollama>=0.2.0

# File watching
watchfiles>=0.21.0

# Text processing
tiktoken>=0.7.0         # token counting for chunking

# Utilities
httpx>=0.27.0
python-dotenv>=1.0.0
```

---

## 10. Startup Sequence

```
1. Start ChromaDB server          chromadb run --port 8001
2. Start Ollama                   ollama serve
3. Pull models (first run)        ollama pull qwen3:8b nomic-embed-text
4. Start Agent service            cd agents && uvicorn main:app --port 8000
5. Start wiki-explorer            npm run dev
```

A `start-ai.sh` script and updated `package.json` `dev:ai` script will orchestrate steps 1–5.

---

## 11. Phased Build Plan

### Phase 1 — Foundation
- [ ] `agents/` scaffold: FastAPI app, config, health endpoint
- [ ] `OllamaService`: generate (streaming) + embed
- [ ] `ChromaService`: collection CRUD, upsert, query
- [ ] Express `/api/ai/status` proxy

### Phase 2 — Ingestion Agent
- [ ] `MarkItDownService`: convert file → markdown
- [ ] Chunker: paragraph-aware, token-counted
- [ ] `IngestionAgent`: watcher + pipeline
- [ ] Express `/api/ai/queue` + WebSocket events
- [ ] `IngestStatus` UI component

### Phase 3 — Wiki Agent
- [ ] `WikiAgent`: chunk fetch + Qwen3 synthesis
- [ ] Wiki page writer + frontmatter parser
- [ ] Stub page creation for unresolved wikilinks
- [ ] Auto-trigger after ingestion

### Phase 4 — Search Agent
- [ ] `SearchAgent`: embed → ChromaDB → RAG → stream
- [ ] Express `/api/ai/search` proxy
- [ ] `AISearch` UI component with streaming display
- [ ] Source cards + wiki page deep links

### Phase 5 — Polish
- [ ] `start-ai.sh` orchestration script
- [ ] `.env.example` with all defaults
- [ ] Error recovery: dead letter queue for failed ingestions
- [ ] ChromaDB collection-per-wiki isolation
- [ ] Search history persistence
