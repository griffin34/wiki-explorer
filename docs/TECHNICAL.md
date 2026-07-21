# Wiki Explorer — Technical Documentation

Technical documentation for Wiki Explorer.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Tech Stack](#tech-stack)
4. [Data Flow](#data-flow)
5. [AI Agents Deep Dive](#ai-agents-deep-dive)
6. [Configuration Files](#configuration-files)
7. [Build Process](#build-process)
8. [Testing](#testing)
9. [Environment Variables & Ports](#environment-variables--ports)

---

## Architecture Overview

Wiki Explorer follows a multi-tier architecture with four main components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ELECTRON SHELL                                 │
│                         (Desktop App Container)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐         ┌─────────────────┐         ┌─────────────┐  │
│   │  React Frontend │◄───────►│  Express Server │◄───────►│   Python    │  │
│   │   (Vite Dev)    │   REST  │   + WebSocket   │  Proxy  │   Agent     │  │
│   │                 │   /WS   │                 │         │   Service   │  │
│   │  • WikiPage     │         │  • File Watcher │         │             │  │
│   │  • GraphView    │         │  • Wiki CRUD    │         │  • Ingest   │  │
│   │  • AISearch     │         │  • IDE Launch   │         │  • Search   │  │
│   │  • Sidebar      │         │  • Upload/Text  │         │  • WikiGen  │  │
│   └────────┬────────┘         └────────┬────────┘         └──────┬──────┘  │
│            │                           │                          │         │
│            │ :5173                     │ :3001                    │ :8000   │
│            └───────────────────────────┴──────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
            │   ChromaDB    │   │    Ollama     │   │  File System  │
            │  Vector Store │   │   LLM + Embed │   │   (Wikis)     │
            │    :8001      │   │    :11434     │   │               │
            └───────────────┘   └───────────────┘   └───────────────┘
```

### Communication Flow

1. **React Frontend ↔ Express Server**
   - REST API calls (`/api/*`) for data operations
   - WebSocket (`/ws`) for real-time file change notifications
   - Vite dev server proxies API requests to Express in development

2. **Express Server ↔ Python Agent**
   - Express proxies AI requests to the agent service
   - Agent notifies Express via `POST /api/ai/notify` for real-time events
   - Express broadcasts events to connected WebSocket clients

3. **Python Agent ↔ External Services**
   - Ollama: LLM generation (`qwen3:8b`) and embeddings (`nomic-embed-text`)
   - ChromaDB: Vector storage and semantic search
   - File System: Watches inbox folders, reads/writes wiki files

---

## Directory Structure

```
wiki-explorer/
├── agents/                    # Python AI service
│   ├── main.py               # FastAPI app entry point
│   ├── config.py             # Pydantic settings (ports, models, thresholds)
│   ├── requirements.txt      # Python dependencies
│   ├── agents/               # Core agent implementations
│   │   ├── ingestion.py      # Inbox watcher, file processing, ChromaDB indexing
│   │   ├── search.py         # RAG-based semantic search
│   │   └── wiki.py           # Wiki page generation from source docs
│   ├── models/
│   │   └── schemas.py        # Pydantic request/response models
│   └── services/
│       ├── chroma_service.py # ChromaDB client wrapper
│       ├── ollama_service.py # Ollama API client (generate, embed)
│       └── markitdown_service.py  # Document conversion (PDF, DOCX, email, etc.)
│
├── build/                     # Electron build resources
│   └── entitlements.mac.plist # macOS code signing entitlements
│
├── data/
│   └── vaults.json           # Registry of added wikis (id, name, path, color)
│
├── docs/                      # Documentation
│   ├── USER-GUIDE.md
│   └── TECHNICAL.md          # This file
│
├── electron/                  # Electron desktop wrapper
│   ├── main.ts               # Main process: window, services, menu
│   └── preload.ts            # Context bridge (if needed)
│
├── public/
│   └── fonts/                # Custom fonts
│
├── scripts/                   # Build and run scripts
│   ├── build-app.sh          # macOS app build script
│   ├── start-ai.sh           # Full stack startup (AI + server + UI)
│   └── start.sh              # Server + UI only (no AI)
│
├── server/
│   ├── index.ts              # Express server + WebSocket
│   └── index.test.ts         # Server integration tests
│
├── src/                       # React frontend
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Router configuration
│   ├── ThemeContext.tsx      # Theme provider (dark/brand modes)
│   ├── index.css             # Global styles + Tailwind imports
│   ├── components/
│   │   ├── AISearch.tsx      # Chat-style AI search interface
│   │   ├── AIToast.tsx       # AI status notifications
│   │   ├── CreateWikiWizard.tsx  # LLM-assisted wiki creation
│   │   ├── GraphView.tsx     # D3.js wiki link graph visualization
│   │   ├── IDELaunchModal.tsx # IDE picker for opening wiki folders
│   │   ├── IngestStatus.tsx  # Real-time ingestion progress
│   │   ├── Layout.tsx        # Main app layout with resizable sidebar
│   │   ├── LogView.tsx       # Wiki activity log viewer
│   │   ├── Sidebar.tsx       # Page tree + search + file upload
│   │   ├── VaultSelector.tsx # Wiki selection/creation home page
│   │   └── WikiPage.tsx      # Markdown page renderer
│   ├── hooks/
│   │   └── useWiki.ts        # Data fetching hooks (wikis, pages, search, WS)
│   ├── styles/
│   │   └── themes.css        # CSS custom properties for theming
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── utils/
│       └── dragDrop.ts       # Drag-and-drop file handling
│
├── wiki-template/             # Template copied when creating new wikis
│
├── coverage/                  # Test coverage reports
│
├── app/                       # Built Electron app output (.dmg, .zip)
│
├── package.json              # npm scripts and dependencies
├── tsconfig.json             # Frontend TypeScript config
├── tsconfig.server.json      # Server TypeScript config
├── tsconfig.electron.json    # Electron TypeScript config
├── vite.config.ts            # Vite bundler configuration
├── vitest.config.ts          # Test runner configuration
├── tailwind.config.js        # Tailwind CSS configuration
├── postcss.config.js         # PostCSS configuration
└── electron-builder.yml      # Electron packaging configuration
```

---

## Tech Stack

> See `package.json` and `agents/requirements.txt` for current versions.

### Frontend

| Technology | Purpose |
|------------|---------|
| React | UI framework |
| TypeScript | Type safety |
| Vite | Build tool and dev server |
| React Router | Client-side routing |
| Tailwind CSS | Utility-first styling |
| D3.js | Graph visualization |
| react-markdown | Markdown rendering |
| react-dropzone | File upload drag-and-drop |
| lucide-react | Icon library |

### Backend (Express)

| Technology | Purpose |
|------------|---------|
| Express | HTTP server |
| WebSocket (ws) | Real-time file updates |
| chokidar | File system watching |
| gray-matter | YAML frontmatter parsing |
| multer | File upload handling |

### Desktop (Electron)

| Technology | Purpose |
|------------|---------|
| Electron | Desktop app shell |
| electron-builder | Cross-platform packaging |

### AI / Python

| Technology | Purpose |
|------------|---------|
| FastAPI | Python REST API framework |
| Ollama | Local LLM inference server |
| ChromaDB | Vector database for embeddings |
| markitdown | Document conversion (PDF, DOCX, PPTX, email) |
| watchfiles | Async file system watching |
| httpx | Async HTTP client |
| pydantic | Data validation and settings |

### AI Models

| Model | Purpose |
|-------|---------|
| `qwen3:8b` | Text generation (RAG answers, wiki page creation) |
| `nomic-embed-text` | Text embeddings (768 dimensions, 2048 token limit) |

---

## Data Flow

### 1. Page Loading and Rendering

```
┌──────────┐     GET /api/wikis/:id/wiki/:pageId     ┌──────────┐
│  React   │ ──────────────────────────────────────► │  Express │
│ WikiPage │                                         │  Server  │
└────┬─────┘                                         └────┬─────┘
     │                                                    │
     │                                                    ▼
     │                                          ┌─────────────────┐
     │                                          │ 1. Sanitize ID  │
     │                                          │ 2. Read .md     │
     │                                          │ 3. Parse YAML   │
     │                                          │ 4. Extract links│
     │                                          │ 5. Find backlinks│
     │                                          └────────┬────────┘
     │                                                   │
     │  { frontmatter, content, links, backlinks }       │
     │ ◄─────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────┐
│ 1. processWikiLinks() → convert [[...]] │
│ 2. ReactMarkdown renders with plugins   │
│ 3. Display frontmatter badges/tags      │
│ 4. Show backlinks section               │
└──────────────────────────────────────────┘
```

### 2. AI Semantic Search Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              USER QUERY                                    │
│                         "What is LlamaIndex?"                              │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. Express Proxy                                                          │
│    POST /api/ai/search → proxies to agent at :8000/search                │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. SearchAgent.search()                                                   │
│    a) Embed query via Ollama → 768-dim vector                            │
│    b) Query ChromaDB with cosine similarity                              │
│    c) Filter by score threshold (≥0.30)                                  │
│    d) Deduplicate (max 3 chunks per source)                              │
│    e) Take top 5 results                                                  │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. RAG Generation                                                         │
│    Build prompt:                                                          │
│    ┌────────────────────────────────────────────────────────────────────┐│
│    │ Answer the following question using ONLY the provided context.     ││
│    │ Cite sources inline as [1], [2], etc.                              ││
│    │                                                                     ││
│    │ Question: What is LlamaIndex?                                       ││
│    │ Context:                                                            ││
│    │ [1] LlamaIndex is a data framework for LLM applications...         ││
│    │ [2] The framework provides indexing and retrieval...               ││
│    └────────────────────────────────────────────────────────────────────┘│
│    Send to Ollama qwen3:8b for generation                                │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. Response                                                               │
│    {                                                                      │
│      "answer": "LlamaIndex is a data framework... [1][2]",              │
│      "sources": [{ title, file, excerpt, score }, ...],                  │
│      "query_time_ms": 1234                                               │
│    }                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3. Inbox Ingestion Pipeline

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    FILE DROPPED IN raw/inbox/                            │
│                      (detected by watchfiles)                            │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. IngestionAgent._watch_inbox()                                         │
│    • Detects new/modified file                                           │
│    • Adds to async queue                                                 │
│    • Notifies Express: ai:ingest:start                                   │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. Document Conversion (MarkItDownService)                               │
│    Supported formats:                                                     │
│    • Markdown (.md), Text (.txt), HTML                                   │
│    • PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx)               │
│    • Email (.eml, .msg) with header extraction                           │
│    • Images (OCR via LLM if available)                                   │
│    Returns: { text, title, source_type }                                 │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. Text Chunking                                                         │
│    • Paragraph-aware splitting (400 words/chunk, 50 word overlap)       │
│    • Character limit safety (2500 chars max per chunk)                   │
│    • Handles long content gracefully                                     │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. Embedding Generation                                                   │
│    • Each chunk → Ollama nomic-embed-text → 768-dim vector              │
│    • Truncates to 3000 chars (~750 tokens) for safety                   │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 5. ChromaDB Upsert                                                        │
│    • Collection: wiki_{wiki_id}_chunks                                   │
│    • Metadata: source_file, chunk_index, title, source_type             │
│    • Uses cosine similarity (hnsw:space = cosine)                        │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 6. File Move & Wiki Generation                                           │
│    • Move file: raw/inbox/ → raw/processed/YYYY-MM/                     │
│    • If wiki_auto_generate enabled:                                      │
│      WikiAgent.enqueue() → generates wiki page from chunks              │
│    • Notifies Express: ai:ingest:done                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## AI Agents Deep Dive

### IngestionAgent (`agents/agents/ingestion.py`)

The ingestion agent is the core file processing pipeline responsible for:

**Lifecycle Management:**
```python
async def start(self) -> None:
    """Load wikis from vaults.json, start inbox watchers, start queue processor."""
    await self._load_and_register_all_wikis()
    self._processor_task = asyncio.create_task(self._process_queue())
    self._vault_watcher_task = asyncio.create_task(self._watch_vaults_file())
```

**Key Components:**

| Component | Purpose |
|-----------|---------|
| `_wiki_configs` | Dict mapping wiki_id → WikiConfig |
| `_watchers` | Dict mapping wiki_id → asyncio.Task (inbox watchers) |
| `_queue` | asyncio.Queue for file processing |
| `_active` | Status tracking for in-progress files |
| `_queue_history` | Recent completion history |

**Inbox Watching:**
- Uses `watchfiles` library for async file system monitoring
- Watches `raw/inbox/` directory for each registered wiki
- Detects `Change.added` and `Change.modified` events
- Automatically enqueues detected files for processing

**Reindexing:**
```python
async def reindex_wiki(self, wiki_id: str, include_wiki_pages: bool = True) -> dict:
    """Re-scan and reindex all documents, replacing existing embeddings."""
    # 1. Purge existing ChromaDB collection
    # 2. Scan raw/processed/** and optionally wiki/**
    # 3. Queue all files for reprocessing
```

### SearchAgent (`agents/agents/search.py`)

Implements RAG-based semantic search:

```python
async def search(self, wiki_id: str, query: str, top_k: int = 10) -> SearchResponse:
    # 1. Embed query
    query_embedding = await self._ollama.embed(query)
    
    # 2. Query ChromaDB
    raw = await self._chroma.query_chunks(wiki_id, query_embedding, n_results=top_k)
    
    # 3. Score and filter (threshold: 0.30)
    # 4. Deduplicate (max 3 chunks per source file)
    # 5. Build RAG prompt with top 5 excerpts
    # 6. Generate answer via Ollama
    # 7. Return answer + sources
```

**RAG Prompt Template:**
```
Answer the following question using ONLY the provided context excerpts.
If the answer cannot be found in the context, say so clearly.
Cite sources inline as [1], [2], etc.

Question: {query}

Context:
[1] {excerpt1}
[2] {excerpt2}
...

Answer concisely using Markdown formatting.
```

### WikiAgent (`agents/agents/wiki.py`)

Generates wiki pages from processed source documents:

**Page Generation Flow:**
1. Fetch all chunks for source file from ChromaDB
2. Sort chunks by `chunk_index`
3. Build context up to `wiki_max_context_words` (6000)
4. Generate page using LLM with strict format prompt
5. Parse frontmatter (title, type, tags)
6. Write to `wiki/` directory with slug filename

**Generated Page Format:**
```markdown
---
title: <descriptive title>
type: <concept|entity|overview|analysis|source>
tags: [tag1, tag2, tag3]
sources: 1
created: 2024-01-15
---

## Summary
<2-3 sentence summary>

## Key Points
<bullet points>

## Details
<detailed content with [[WikiLink]] syntax>
```

### Services

#### ChromaService (`agents/services/chroma_service.py`)

ChromaDB client wrapper for vector operations:

```python
class ChromaService:
    async def get_or_create_collection(self, wiki_id: str) -> Collection
    async def upsert_chunks(self, wiki_id, ids, documents, embeddings, metadatas)
    async def query_chunks(self, wiki_id, query_embedding, n_results, where=None)
    async def get_chunks_by_source(self, wiki_id, source_file) -> dict
    async def delete_collection(self, wiki_id) -> None
    async def collection_count(self, wiki_id) -> int
```

- Collection naming: `wiki_{wiki_id}_chunks`
- Uses cosine similarity (`hnsw:space: cosine`)
- Connects to ChromaDB HTTP server at `localhost:8001`

#### OllamaService (`agents/services/ollama_service.py`)

Ollama API client for LLM operations:

```python
class OllamaService:
    async def generate(self, prompt: str, system: str = None) -> str
        # Strips <think>...</think> blocks from response
        
    async def embed(self, text: str, max_chars: int = 3000) -> list[float]
        # Truncates text for safety (2048 token model limit)
        # Cleans problematic characters
```

- Generation model: `qwen3:8b`
- Embedding model: `nomic-embed-text`
- Timeout: 120 seconds
- Base URL: `http://localhost:11434`

#### MarkItDownService (`agents/services/markitdown_service.py`)

Document conversion using Microsoft's markitdown library:

**Supported Formats:**
| Category | Extensions |
|----------|------------|
| Documents | `.md`, `.txt`, `.pdf`, `.docx`, `.doc`, `.rtf`, `.odt` |
| Presentations | `.pptx`, `.ppt` |
| Spreadsheets | `.xlsx`, `.xls`, `.csv` |
| Web | `.html`, `.htm`, `.xml`, `.json` |
| Email | `.eml`, `.msg`, `.mht`, `.mhtml` |
| Other | `.rst`, `.epub` |

**Email Parsing:**
- Custom `.eml` parser using Python's `email` library
- Extracts: Subject, From, To, Date
- Prefers plain text body, falls back to HTML→text conversion
- Strips base64 images and binary data

---

## Configuration Files

### tsconfig.json (Frontend)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,              // Vite handles compilation
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "server", "**/*.test.*"]
}
```

### tsconfig.server.json (Express)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist-server"
  },
  "include": ["server"]
}
```

### tsconfig.electron.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "./electron",
    "rootDir": "./electron",
    "sourceMap": true
  },
  "include": ["electron/**/*.ts"]
}
```

### vite.config.ts

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:3001', ws: true },
    },
  },
})
```

### electron-builder.yml

Key configuration:
- **appId:** `com.wiki-explorer.app`
- **Output:** `app/` directory
- **macOS:** Universal binary (arm64 + x64), DMG + ZIP
- **Features:** Dark mode support, hardened runtime, code signing

### vitest.config.ts

```typescript
export default defineConfig({
  test: {
    environment: 'happy-dom',           // DOM APIs for React tests
    environmentMatchGlobs: [
      ['server/**', 'node'],            // Node env for server tests
    ],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})
```

---

## Build Process

### Development

```bash
# Start full stack (UI + server + AI)
./scripts/start-ai.sh

# Or without AI services
npm run dev
```

### Production Build (`scripts/build-app.sh`)

**Step-by-step process:**

1. **Install npm dependencies**
   ```bash
   npm install
   ```

2. **Build frontend (Vite)**
   ```bash
   npm run build
   # Output: dist/
   ```

3. **Compile Electron TypeScript**
   ```bash
   npx tsc -p tsconfig.electron.json
   # Output: electron/*.js
   ```

4. **Set up Python environment**
   ```bash
   python3 -m venv agents/.venv
   source agents/.venv/bin/activate
   pip install -r agents/requirements.txt
   ```

5. **Build macOS app**
   ```bash
   npm run electron:build:mac
   # Uses electron-builder with electron-builder.yml
   ```

6. **Clean up artifacts**
   - Removes intermediate files
   - Keeps only `.dmg` and `.zip`

**Output artifacts:**
```
app/
├── Wiki Explorer-1.0.0-universal.dmg   # macOS installer
└── Wiki Explorer-1.0.0-universal.zip   # Portable archive
```

### Electron Startup Sequence

When the Electron app launches (`electron/main.ts`):

1. **Start AI Services** (if not already running)
   - ChromaDB server (port 8001)
   - Ollama server (port 11434) + model pull
   - Python agent service (port 8000)

2. **Start Express Server** (production only)
   - Development expects `npm run dev` to be running

3. **Create Browser Window**
   - Load `http://localhost:3001` (production)
   - Load `http://localhost:5173` (development)

4. **Service Health Monitoring**
   - Polls services until ready
   - Shows warning dialogs if Ollama not installed

---

## Testing

### Running Tests

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch

# With coverage report
npm run test:coverage
```

### Test File Locations

| Location | Purpose |
|----------|---------|
| `src/**/*.test.tsx` | React component tests |
| `src/**/*.test.ts` | Hook and utility tests |
| `server/index.test.ts` | Express server integration tests |

### Test Stack

- **vitest:** Test runner
- **@testing-library/react:** Component testing utilities
- **happy-dom:** Fast DOM implementation for React tests
- **supertest:** HTTP assertion library for server tests
- **@vitest/coverage-v8:** Coverage instrumentation

### Coverage Requirements

The project enforces **100% coverage** on:
- Statements
- Branches
- Functions
- Lines

Exclusions: `main.tsx`, `test-utils.tsx`, test files, type definitions

### Example Test

```typescript
// src/components/WikiPage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import WikiPage from './WikiPage'

test('shows loading state', () => {
  render(
    <MemoryRouter initialEntries={['/wiki/abc/page/index']}>
      <Routes>
        <Route path="/wiki/:wikiId/page/*" element={<WikiPage />} />
      </Routes>
    </MemoryRouter>
  )
  expect(screen.getByRole('status')).toBeInTheDocument()
})
```

---

## Environment Variables & Ports

### Port Assignments

| Port | Service | Purpose |
|------|---------|---------|
| 5173 | Vite Dev Server | Frontend hot-reload (development only) |
| 3001 | Express Server | REST API + WebSocket + static files |
| 8000 | Python Agent | AI services (ingest, search, wiki-gen) |
| 8001 | ChromaDB | Vector database HTTP API |
| 11434 | Ollama | LLM inference server |

### Environment Variables

**Express Server:**
```bash
NODE_ENV=development|production|test
WIKI_DATA_DIR=/path/to/data       # Override data directory (tests)
AGENT_SERVICE_URL=http://localhost:8000
```

**Python Agent (`agents/config.py`):**
```bash
# Can be set in agents/.env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_TIMEOUT=120

CHROMA_HOST=localhost
CHROMA_PORT=8001

AGENT_PORT=8000
EXPRESS_URL=http://localhost:3001
```

**Configuration Defaults (`agents/config.py`):**
```python
class Settings(BaseSettings):
    # Chunking
    chunk_size: int = 400          # words per chunk
    chunk_overlap: int = 50        # word overlap
    
    # Wiki generation
    wiki_auto_generate: bool = True
    wiki_max_context_words: int = 6000
    
    # Search / RAG
    search_top_k: int = 10
    search_score_threshold: float = 0.30
    search_max_chunks_per_source: int = 3
```

---

## Security Considerations

### Path Traversal Prevention

The Express server implements multiple security measures:

```typescript
// Validate page IDs
function sanitizePageId(pageId: string): string {
  return pageId
    .split('/')
    .filter(segment => segment !== '..' && segment !== '.' && segment !== '')
    .join('/')
}

// Validate resolved paths stay within base directory
function isPathWithinBase(filePath: string, baseDir: string): boolean {
  const resolvedPath = path.resolve(filePath)
  const resolvedBase = path.resolve(baseDir)
  return resolvedPath.startsWith(resolvedBase + path.sep)
}
```

### File Upload Restrictions

```typescript
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.md', '.txt', '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.xls', '.xlsx', '.csv', '.json', '.html', '.htm', '.xml',
  '.rst', '.rtf', '.odt', '.epub', '.png', '.jpg', '.jpeg',
  '.eml', '.msg', '.mht', '.mhtml'
])

const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50MB
const MAX_FILES_PER_REQUEST = 20
```

### IDE Launch Safety

- Uses `execFile` instead of shell execution
- Validates folder paths exist before launching
- Supports only whitelisted IDEs (VS Code, Cursor, JetBrains, etc.)

---

## Glossary

| Term | Definition |
|------|------------|
| **Wiki** | A folder containing markdown files and optional AI-processed content |
| **Wiki Mode** | Wiki has `wiki/` and `raw/` structure (AI-enhanced) |
| **Folder Mode** | Plain markdown folder (no AI processing) |
| **Inbox** | `raw/inbox/` folder watched for new files to process |
| **RAG** | Retrieval-Augmented Generation |
| **Chunk** | Text segment (~400 words) stored as embedding |
| **Backlink** | Page that links TO the current page |
| **WikiLink** | `[[PageName]]` syntax for internal links |
