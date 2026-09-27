# AI Agents Design — wiki-explorer

> **Status:** Implemented  
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
│                         │  - /api/ai/* proxy routes            │ │
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
│                         │  │  → extract entities             │ │ │
│                         │  │  → generate source + entity     │ │ │
│                         │  │    pages → wiki/{type}/*.md     │ │ │
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
                                                       │  wiki/people/ │
                                                       │  wiki/tech/   │
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

**Responsibility:** Synthesize structured wiki pages from ingested document chunks using Qwen3, including automatic **entity extraction** to create pages for people, technologies, projects, and concepts.

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
┌──────────────────────────────────────────────────────┐
│  ENTITY EXTRACTION (NEW)                             │
│                                                      │
│  Qwen3 prompt: "Extract entities from this content"  │
│      → JSON: { entities: [...] }                     │
│                                                      │
│  Entity types:                                       │
│    • person — named individuals                      │
│    • technology — tools, platforms, systems          │
│    • project — named initiatives, products           │
│    • organization — companies, teams, departments    │
│    • concept — methodologies, domain concepts        │
└──────────────────────────────────────────────────────┘
    │
    ▼
Generate SOURCE PAGE (summary of the document)
    → wiki/{slug}.md
    │
    ▼
For each extracted entity:
    │
    ├─► Entity page exists?
    │     YES → Update Related section with new source link
    │     NO  → Generate new entity page
    │
    └─► Write to organized folders:
          wiki/people/{slug}.md
          wiki/tech/{slug}.md
          wiki/projects/{slug}.md
          wiki/orgs/{slug}.md
          wiki/concepts/{slug}.md
    │
    ▼
Update: wiki/index.md (add source page to registry)
    │
    ▼
Update ChromaDB metadata: set wiki_page field on all source chunks
    │
    ▼
WebSocket notification → UI (new pages available)
```

**Entity Extraction Output:**

```json
{
  "entities": [
    {
      "name": "Kara Dave",
      "type": "person",
      "description": "Project lead coordinating cross-team efforts",
      "context": "Leads the Day Dotting initiative"
    },
    {
      "name": "Project RIO",
      "type": "technology",
      "description": "Framework for mobile integration",
      "context": "Being evaluated for system compatibility"
    }
  ]
}
```

**Generated Entity Page Structure:**

```markdown
---
title: Kara Dave
type: entity
entity_type: person
tags: [person]
sources: 1
created: 2026-07-27
---

## Overview

Kara Dave is a project lead coordinating cross-team efforts.

## Role & Context

<How this entity relates to the source document>

## Related

- [[day-dotting-project-update]] — Source document
```

**Source Page Prompt Template:**

```
Source: {source_title} ({source_type})

{context}

Generate a wiki page summarizing this source document:

---
title: {source_title}
type: source
tags: [source, {source_type}]
sources: 1
created: {today}
---

## Summary
<2-3 sentence summary>

## Key Information
<Bullet points of important facts>

## People Mentioned
<List with [[PersonName]] wiki links>

## Technologies & Tools
<List with [[TechName]] wiki links>

## Related
<List related topics with [[WikiLink]] syntax>
```

**Page types generated:**
- `source` — summary page for each ingested document
- `entity` — auto-extracted people, technologies, projects, organizations, concepts

**Entity folder structure:**

```
wiki/
├── index.md
├── day-dotting-project-update.md    ← source page
├── people/
│   ├── kara-dave.md
│   ├── glenn-howald.md
│   └── jason-griffin.md
├── tech/
│   ├── project-rio.md
│   ├── zebra-zq620.md
│   └── chromadb.md
├── projects/
│   └── automated-day-dotting.md
├── orgs/
│   └── starbucks.md
└── concepts/
    └── feasibility-testing.md
```

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
    → List[Result { text, distance, metadata }]
    │
    ▼
Score conversion: score = 1.0 - distance  (cosine)
    │
    ▼
Score threshold filter  (score > SEARCH_SCORE_THRESHOLD, default 0.35)
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

**Configuration (agents/.env):**

```env
SEARCH_SCORE_THRESHOLD=0.35    # Lower = more results, higher = stricter matching
SEARCH_TOP_K=10                # Max results to retrieve from ChromaDB
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
```

---

### 3.4 Edit Agent

**Responsibility:** Enable both manual edits and AI-powered bulk edits to wiki pages, with full change tracking (original content, change, and change date).

**Trigger:**
- Manual — via `PUT /pages/:slug` API (UI editor)
- AI Bulk — via `POST /edit` API with natural language instruction

**Change Tracking Architecture:**

Every edit is recorded in two places:
1. **Page frontmatter** — `modified` date and `revision` number
2. **Changelog** — `wiki/.changelog/YYYY-MM-DD.json` files with detailed before/after records

```
wiki/
├── .changelog/
│   ├── 2026-07-24.json       ← day's edits
│   ├── 2026-07-23.json
│   └── index.json            ← summary index
├── project-team.md
├── quarterly-review.md
└── index.md
```

**Changelog entry schema:**

```json
{
  "id": "edit_abc123",
  "timestamp": "2026-07-24T14:30:00Z",
  "type": "ai_bulk",
  "instruction": "Jessica was replaced by Amanda on the project",
  "changes": [
    {
      "page": "project-team.md",
      "revision": 3,
      "hunks": [
        {
          "line_start": 12,
          "line_end": 12,
          "before": "**Project Lead:** Jessica Chen",
          "after": "**Project Lead:** Amanda Torres (replaced Jessica Chen on 2026-07-24)"
        },
        {
          "line_start": 45,
          "line_end": 47,
          "before": "Contact Jessica for approvals.\nShe handles all budget decisions.",
          "after": "Contact Amanda Torres for approvals.\nShe handles all budget decisions.\n\n> _Note: Amanda replaced Jessica Chen on 2026-07-24._"
        }
      ]
    },
    {
      "page": "quarterly-review.md",
      "revision": 2,
      "hunks": [
        {
          "line_start": 8,
          "line_end": 8,
          "before": "Presented by Jessica Chen",
          "after": "Presented by Jessica Chen _(now Amanda Torres)_"
        }
      ]
    }
  ],
  "affected_pages": ["project-team.md", "quarterly-review.md"],
  "user": "ai_agent"
}
```

**AI Bulk Edit Pipeline:**

```
User instruction: "Jessica was replaced by Amanda on the project"
    │
    ▼
Parse instruction → extract entities + intent
    │
    ▼
Semantic search: find all pages mentioning "Jessica"
    → ChromaDB query + full-text grep
    │
    ▼
For each matching page:
    │
    ├─► Identify relevant passages (not just name occurrences)
    │   → Context-aware: roles, responsibilities, contact info
    │
    ├─► Generate proposed edit via Qwen3
    │   → Preserve historical accuracy where appropriate
    │   → Add transition notes where helpful
    │
    └─► Build change preview with before/after
    │
    ▼
Return edit proposal:
    {
      instruction: "...",
      affected_pages: [...],
      changes: [...],         // detailed hunks
      preview_diff: "..."     // unified diff for UI
    }
    │
    ▼
[User approves / modifies / rejects]
    │
    ▼
Apply changes:
    → Write updated page content
    → Update frontmatter (modified, revision++)
    → Append to changelog
    → Update ChromaDB embeddings for changed chunks
    │
    ▼
WebSocket notification → UI
```

**Qwen3 Edit Prompt Template:**

```
You are editing a wiki page based on this instruction:
"{instruction}"

Current page content:
---
{page_content}
---

Entity mapping:
- Old: {old_entity} (Jessica Chen)
- New: {new_entity} (Amanda Torres)  
- Change date: {change_date}

Rules:
1. Replace references to the old entity with the new entity
2. For historical facts (past events), keep the original name but add a note
3. For current roles/responsibilities, update to the new entity
4. Add transition notes where context is helpful
5. Preserve all other content exactly

Output the complete updated page content.
```

**Manual Edit Flow:**

For simple edits via the UI editor:

```
PUT /api/wikis/:wiki_id/pages/:slug
{
  "content": "updated markdown content",
  "reason": "Fixed typo in section header"   // optional
}
```

The server:
1. Reads current page content
2. Computes diff (hunks)
3. Increments revision in frontmatter
4. Sets `modified: <today>`
5. Writes changelog entry (type: `manual`)
6. Saves file
7. Updates ChromaDB if content changed significantly

**Revision History UI:**

The page viewer gains a "History" tab showing:
- Timeline of changes
- Expandable diffs
- "Revert to revision N" action
- Filter by edit type (manual / ai_bulk)

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
│   │   ├── search.py                Search Agent
│   │   └── edit.py                  Edit Agent (manual + AI bulk)
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── chroma_service.py        ChromaDB CRUD + collection management
│   │   ├── ollama_service.py        Generate + embed via Ollama REST
│   │   ├── markitdown_service.py    Document → Markdown conversion
│   │   └── changelog_service.py     Change tracking + revision history
│   │
│   └── models/
│       ├── __init__.py
│       └── schemas.py               Pydantic request/response models
│
├── server/
│   └── index.ts                     ADD: /api/ai/* proxy routes + edit routes
│
└── src/
    └── components/
        ├── AISearch.tsx             NEW: Chat-style search panel
        ├── AIEditPanel.tsx          NEW: Bulk edit instruction + diff preview
        ├── IngestStatus.tsx         NEW: Ingestion queue badge/drawer
        ├── PageEditor.tsx           NEW: Inline markdown editor
        └── PageHistory.tsx          NEW: Revision timeline + revert
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
| `POST` | `/edit/preview` | Preview AI bulk edit `{ wiki_id, instruction }` → proposed changes |
| `POST` | `/edit/apply` | Apply approved edits `{ wiki_id, edit_id, changes }` |
| `GET` | `/edit/history` | Edit history for wiki `{ wiki_id, page?, limit? }` |

### Express Server — new proxy routes

The Express server adds a thin proxy layer and handles wiki lifecycle events:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai/status` | Health check (proxied + formatted) |
| `POST` | `/api/ai/search` | Proxy to `/search` |
| `POST` | `/api/ai/ingest` | Proxy to `/ingest` |
| `GET` | `/api/ai/queue` | Proxy to `/ingest/queue` |
| `POST` | `/api/ai/wiki/generate` | Proxy to `/wiki/generate` |
| `POST` | `/api/ai/edit/preview` | Proxy to `/edit/preview` |
| `POST` | `/api/ai/edit/apply` | Proxy to `/edit/apply` |
| `GET` | `/api/ai/edit/history` | Proxy to `/edit/history` |
| `PUT` | `/api/wikis/:id/pages/:slug` | Manual page edit with changelog |
| `GET` | `/api/wikis/:id/pages/:slug/history` | Page revision history |
| `POST` | `/api/wikis/:id/pages/:slug/revert` | Revert to specific revision |

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

### `PageEditor` — inline markdown editor

A toggle mode on the page viewer:
- CodeMirror-based markdown editor with syntax highlighting
- Live preview pane (side-by-side or toggle)
- "Save" button with optional reason field
- Keyboard shortcuts (Cmd+S to save, Esc to cancel)
- Unsaved changes warning

### `AIEditPanel` — bulk edit interface

A command palette or dedicated panel for AI-powered edits:
- Natural language instruction input
- "Preview Changes" button → shows affected pages
- Diff viewer for each proposed change
- Checkboxes to include/exclude individual changes
- "Apply Selected" / "Apply All" buttons
- Progress indicator during edit application

### `PageHistory` — revision timeline

A history tab/drawer on each page:
- Timeline of changes (date, type, summary)
- Expandable unified diff for each revision
- "Revert to this version" action
- Filter by edit type (manual / ai_bulk)
- Link to full changelog

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

### Phase 6 — Edit Agent
- [ ] `EditAgent`: instruction parsing + semantic page search
- [ ] Qwen3 edit prompt: context-aware replacement generation
- [ ] Changelog infrastructure: `wiki/.changelog/` + daily JSON files
- [ ] Express manual edit routes: `PUT /pages/:slug`, `GET /pages/:slug/history`
- [ ] Express AI edit proxy: `/api/ai/edit/preview`, `/api/ai/edit/apply`
- [ ] `PageEditor` UI: inline markdown editor with save/cancel
- [ ] `AIEditPanel` UI: instruction input + diff preview + apply
- [ ] `PageHistory` UI: revision timeline + revert action
- [ ] ChromaDB re-embedding on significant edits
