# Wiki Explorer API Reference

This document describes all REST API endpoints and WebSocket events in Wiki Explorer.

## Architecture Overview

Wiki Explorer runs two backend services:

| Service | Port | Technology | Purpose |
|---------|------|------------|---------|
| **Express Server** | 3001 | Node.js/Express | Wiki CRUD, file serving, UI backend |
| **Agent Service** | 8000 | Python/FastAPI | AI search, embeddings, wiki generation |

The Express server proxies AI-related requests to the Agent Service via `/api/ai/*` routes.

---

## Express Server (Port 3001)

Base URL: `http://localhost:3001`

### Endpoint Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wikis` | List all wikis |
| POST | `/api/wikis` | Add or create a wiki |
| DELETE | `/api/wikis/:id` | Delete a wiki |
| GET | `/api/wikis/:id/wiki` | List all pages |
| GET | `/api/wikis/:id/wiki/*` | Get page content |
| GET | `/api/wikis/:id/graph` | Get graph data |
| GET | `/api/wikis/:id/search` | Text search |
| GET | `/api/wikis/:id/raw` | List raw source files |
| POST | `/api/wikis/:id/raw/upload` | Upload files |
| POST | `/api/wikis/:id/raw/text` | Save text note |
| GET | `/api/wikis/:id/log` | Get activity log |
| GET | `/api/detect-ides` | Detect installed IDEs |
| POST | `/api/open-in-ide` | Open folder in IDE |
| GET | `/api/pick-folder` | Native folder picker |
| GET | `/api/ai/status` | Agent service health |
| POST | `/api/ai/search` | AI semantic search |
| POST | `/api/ai/ingest` | Trigger file ingestion |
| GET | `/api/ai/queue` | Get ingestion queue |
| POST | `/api/ai/wiki/generate` | Generate wiki page |
| POST | `/api/ai/wikis/:id/reindex` | Reindex wiki |
| POST | `/api/ai/notify` | Agent notification webhook |

---

### Wiki Management

#### GET /api/wikis

List all registered wikis with stats.

**Response:**
```json
[
  {
    "id": "a1b2c3d4",
    "name": "My Research Wiki",
    "path": "/Users/me/wikis/research",
    "color": "#89b4fa",
    "createdAt": "2024-01-15",
    "mode": "wiki",
    "stats": {
      "pageCount": 42,
      "sourceCount": 15,
      "lastActivity": "2024-03-20"
    }
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique wiki identifier |
| `name` | string | Display name |
| `path` | string | Absolute filesystem path |
| `color` | string | Hex color for UI |
| `createdAt` | string | Creation date (YYYY-MM-DD) |
| `mode` | string | `"wiki"` (structured) or `"folder"` (plain markdown) |
| `stats.pageCount` | number | Number of wiki pages |
| `stats.sourceCount` | number | Number of raw source files |
| `stats.lastActivity` | string | Date of last log update |

**curl:**
```bash
curl http://localhost:3001/api/wikis
```

---

#### POST /api/wikis

Add an existing folder or create a new wiki.

**Request Body:**
```json
{
  "name": "My Wiki",
  "wikiPath": "/Users/me/wikis",
  "color": "#89b4fa",
  "create": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Display name |
| `wikiPath` | string | ✓ | Path to wiki folder (or parent if `create: true`) |
| `color` | string | | Hex color (default: `#89b4fa`) |
| `create` | boolean | | If `true`, creates a new wiki with template structure |

When `create: true`, the wiki is created at `{wikiPath}/{slug}` where `slug` is derived from the name.

**Response:**
```json
{
  "id": "a1b2c3d4",
  "name": "My Wiki",
  "path": "/Users/me/wikis/my-wiki",
  "color": "#89b4fa",
  "createdAt": "2024-03-20",
  "stats": {
    "pageCount": 0,
    "sourceCount": 0,
    "lastActivity": "2024-03-20"
  }
}
```

**curl:**
```bash
# Add existing folder
curl -X POST http://localhost:3001/api/wikis \
  -H "Content-Type: application/json" \
  -d '{"name": "My Wiki", "wikiPath": "/path/to/existing/wiki"}'

# Create new wiki
curl -X POST http://localhost:3001/api/wikis \
  -H "Content-Type: application/json" \
  -d '{"name": "New Wiki", "wikiPath": "/path/to/parent", "create": true}'
```

---

#### DELETE /api/wikis/:id

Remove a wiki from the registry (does not delete files).

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Response:**
```json
{ "ok": true }
```

**curl:**
```bash
curl -X DELETE http://localhost:3001/api/wikis/a1b2c3d4
```

---

### Wiki Pages

#### GET /api/wikis/:id/wiki

List all markdown pages in the wiki.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Response:**
```json
[
  {
    "id": "summaries/meeting-notes",
    "title": "Meeting Notes",
    "type": "summary",
    "tags": ["meetings", "project-x"],
    "sources": 3,
    "created": "2024-01-15",
    "updated": "2024-03-20",
    "links": ["people/john-doe", "projects/alpha"],
    "wordCount": 542,
    "excerpt": "Summary of the Q1 planning meeting covering budget allocation and..."
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Page path relative to wiki root (without `.md`) |
| `title` | string | From frontmatter or filename |
| `type` | string | Page type from frontmatter |
| `tags` | string[] | Tags array |
| `sources` | number | Number of sources (from frontmatter) |
| `created` | string | Creation date |
| `updated` | string | Last update date |
| `links` | string[] | Outgoing `[[wikilinks]]` |
| `wordCount` | number | Word count |
| `excerpt` | string | First 160 chars of content |

**curl:**
```bash
curl http://localhost:3001/api/wikis/a1b2c3d4/wiki
```

---

#### GET /api/wikis/:id/wiki/:pageId

Get full content of a specific page.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |
| `pageId` | path | Page path (e.g., `summaries/meeting-notes`) |

**Response:**
```json
{
  "id": "summaries/meeting-notes",
  "frontmatter": {
    "title": "Meeting Notes",
    "type": "summary",
    "tags": ["meetings"],
    "sources": 3,
    "created": "2024-01-15",
    "updated": "2024-03-20"
  },
  "content": "# Meeting Notes\n\nDiscussed [[projects/alpha]] with [[people/john-doe]]...",
  "links": ["projects/alpha", "people/john-doe"],
  "backlinks": ["index", "projects/alpha"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Page path |
| `frontmatter` | object | YAML frontmatter parsed as object |
| `content` | string | Markdown content (without frontmatter) |
| `links` | string[] | Outgoing wikilinks |
| `backlinks` | string[] | Pages that link to this page |

**Error Responses:**
- `400 Bad Request` - Invalid page path (directory traversal attempt)
- `404 Not Found` - Page does not exist

**curl:**
```bash
curl http://localhost:3001/api/wikis/a1b2c3d4/wiki/summaries/meeting-notes
```

---

### Graph

#### GET /api/wikis/:id/graph

Get nodes and edges for the wiki graph visualization.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Response:**
```json
{
  "nodes": [
    {
      "id": "index",
      "title": "Index",
      "type": "index",
      "tags": [],
      "linkCount": 15,
      "wordCount": 120
    },
    {
      "id": "people/john-doe",
      "title": "John Doe",
      "type": "person",
      "tags": ["team-lead"],
      "linkCount": 8,
      "wordCount": 340
    }
  ],
  "links": [
    { "source": "index", "target": "people/john-doe" },
    { "source": "projects/alpha", "target": "people/john-doe" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `nodes[].id` | string | Page path |
| `nodes[].title` | string | Display title |
| `nodes[].type` | string | Page type |
| `nodes[].tags` | string[] | Tags array |
| `nodes[].linkCount` | number | Total links (in + out) |
| `nodes[].wordCount` | number | Word count |
| `links[].source` | string | Source page ID |
| `links[].target` | string | Target page ID |

**curl:**
```bash
curl http://localhost:3001/api/wikis/a1b2c3d4/graph
```

---

### Search

#### GET /api/wikis/:id/search

Full-text search across wiki pages.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |
| `q` | query | Search query (required) |

**Response:**
```json
[
  {
    "id": "summaries/meeting-notes",
    "title": "Meeting Notes",
    "type": "summary",
    "excerpt": "...discussed the budget allocation for Q2...",
    "score": 30
  }
]
```

Results are sorted by score (descending) and limited to 20 results.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Page path |
| `title` | string | Page title |
| `type` | string | Page type |
| `excerpt` | string | Context around match (~200 chars) |
| `score` | number | Relevance score |

**curl:**
```bash
curl "http://localhost:3001/api/wikis/a1b2c3d4/search?q=budget"
```

---

### Raw Sources

#### GET /api/wikis/:id/raw

List files in the `raw/` directory.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Response:**
```json
{
  "files": [
    {
      "path": "inbox/document.pdf",
      "name": "document.pdf",
      "size": 245760,
      "modified": "2024-03-20T14:30:00.000Z"
    }
  ],
  "inboxExists": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `files[].path` | string | Path relative to `raw/` |
| `files[].name` | string | Filename |
| `files[].size` | number | Size in bytes |
| `files[].modified` | string | ISO 8601 timestamp |
| `inboxExists` | boolean | Whether `raw/inbox/` exists |

**curl:**
```bash
curl http://localhost:3001/api/wikis/a1b2c3d4/raw
```

---

#### POST /api/wikis/:id/raw/upload

Upload files to `raw/inbox/`.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Request:** `multipart/form-data` with field `files`

**Limits:**
- Max file size: 50 MB
- Max files per request: 20
- Allowed extensions: `.md`, `.txt`, `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`, `.csv`, `.json`, `.html`, `.htm`, `.xml`, `.rst`, `.rtf`, `.odt`, `.epub`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.eml`, `.msg`, `.mht`, `.mhtml`

**Response:**
```json
{
  "uploaded": [
    {
      "name": "document.pdf",
      "path": "inbox/document.pdf",
      "size": 245760
    }
  ]
}
```

**Error Responses:**
- `400 Bad Request` - No `raw/inbox/` folder (wiki not set up)
- `400 Bad Request` - File type not allowed
- `400 Bad Request` - File too large or too many files

**curl:**
```bash
curl -X POST http://localhost:3001/api/wikis/a1b2c3d4/raw/upload \
  -F "files=@document.pdf" \
  -F "files=@notes.md"
```

---

#### POST /api/wikis/:id/raw/text

Save text content as a markdown file in `raw/inbox/`.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Request Body:**
```json
{
  "filename": "my-notes",
  "content": "# My Notes\n\nSome content here..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filename` | string | | Filename (`.md` extension added if missing) |
| `content` | string | ✓ | Markdown content |

**Response:**
```json
{
  "name": "my-notes.md",
  "path": "my-notes.md",
  "size": 42
}
```

**curl:**
```bash
curl -X POST http://localhost:3001/api/wikis/a1b2c3d4/raw/text \
  -H "Content-Type: application/json" \
  -d '{"filename": "quick-note", "content": "# Quick Note\n\nRemember this."}'
```

---

### Activity Log

#### GET /api/wikis/:id/log

Get activity log entries from `wiki/log.md`.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `id` | path | Wiki ID |

**Response:**
```json
[
  {
    "header": "[2024-03-20] Added meeting-notes.md",
    "body": "- Processed: meeting-recording.mp3\n- Created: [[summaries/meeting-notes]]"
  }
]
```

Entries are parsed from `## [date]` headers in `log.md`.

**curl:**
```bash
curl http://localhost:3001/api/wikis/a1b2c3d4/log
```

---

### IDE Integration

#### GET /api/detect-ides

Detect installed IDEs/editors on the system.

**Response:**
```json
[
  { "id": "cursor", "name": "Cursor" },
  { "id": "vscode", "name": "VS Code" },
  { "id": "webstorm", "name": "WebStorm" }
]
```

Supported IDEs: `cursor`, `vscode`, `windsurf`, `intellij`, `webstorm`, `pycharm`

**curl:**
```bash
curl http://localhost:3001/api/detect-ides
```

---

#### POST /api/open-in-ide

Open a folder in a specific IDE.

**Request Body:**
```json
{
  "ide": "cursor",
  "path": "/Users/me/wikis/research"
}
```

**Response:**
```json
{ "ok": true }
```

**Error Responses:**
- `400 Bad Request` - Missing `ide` or `path`
- `400 Bad Request` - Invalid folder path
- `400 Bad Request` - Unknown IDE
- `500 Internal Server Error` - Failed to launch IDE

**curl:**
```bash
curl -X POST http://localhost:3001/api/open-in-ide \
  -H "Content-Type: application/json" \
  -d '{"ide": "cursor", "path": "/Users/me/wikis/research"}'
```

---

#### GET /api/pick-folder

Open the native OS folder picker dialog.

**Response:**
```json
{ "path": "/Users/me/Documents/selected-folder" }
```

**Error Responses:**
- `400 Bad Request` - User cancelled or no folder selected

**curl:**
```bash
curl http://localhost:3001/api/pick-folder
```

---

### AI Agent Proxy Routes

These endpoints proxy requests to the Python Agent Service (port 8000).

#### GET /api/ai/status

Get health status of the AI agent service.

**Response:**
```json
{
  "status": "ok",
  "ollama": "ok",
  "chroma": "ok",
  "watchers": 2,
  "wikis": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"ok"`, `"degraded"`, or `"unavailable"` |
| `ollama` | string | Ollama service status |
| `chroma` | string | ChromaDB status |
| `watchers` | number | Active file watchers |
| `wikis` | number | Registered wikis |

**curl:**
```bash
curl http://localhost:3001/api/ai/status
```

---

#### POST /api/ai/search

Semantic search using AI embeddings.

**Request Body:**
```json
{
  "wiki_id": "a1b2c3d4",
  "query": "What did we discuss about the budget?",
  "top_k": 5
}
```

**Response:**
```json
{
  "answer": "Based on the meeting notes, the Q2 budget was set at $50,000...",
  "sources": [
    {
      "title": "Q1 Planning Meeting",
      "file": "raw/inbox/meeting.pdf",
      "wiki_page": "summaries/meeting-notes",
      "excerpt": "...budget allocation for Q2 was discussed...",
      "score": 0.89
    }
  ],
  "query_time_ms": 234
}
```

**curl:**
```bash
curl -X POST http://localhost:3001/api/ai/search \
  -H "Content-Type: application/json" \
  -d '{"wiki_id": "a1b2c3d4", "query": "budget discussion", "top_k": 5}'
```

---

#### POST /api/ai/ingest

Queue a file for AI ingestion and embedding.

**Request Body:**
```json
{
  "wiki_id": "a1b2c3d4",
  "file_path": "/Users/me/wikis/research/raw/inbox/document.pdf"
}
```

**Response:**
```json
{
  "ok": true,
  "queued": "/Users/me/wikis/research/raw/inbox/document.pdf"
}
```

**curl:**
```bash
curl -X POST http://localhost:3001/api/ai/ingest \
  -H "Content-Type: application/json" \
  -d '{"wiki_id": "a1b2c3d4", "file_path": "/path/to/file.pdf"}'
```

---

#### GET /api/ai/queue

Get current ingestion queue status.

**Response:**
```json
[
  {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf",
    "status": "processing",
    "error": null,
    "wiki_page": null,
    "created_at": "2024-03-20T14:30:00Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"pending"`, `"processing"`, `"done"`, `"error"` |
| `wiki_page` | string \| null | Generated wiki page path (when done) |
| `error` | string \| null | Error message (when failed) |

**curl:**
```bash
curl http://localhost:3001/api/ai/queue
```

---

#### POST /api/ai/wiki/generate

Generate a wiki page from a source file.

**Request Body:**
```json
{
  "wiki_id": "a1b2c3d4",
  "source_file": "/path/to/raw/inbox/document.pdf"
}
```

**Response:**
```json
{ "ok": true }
```

**curl:**
```bash
curl -X POST http://localhost:3001/api/ai/wiki/generate \
  -H "Content-Type: application/json" \
  -d '{"wiki_id": "a1b2c3d4", "source_file": "/path/to/file.pdf"}'
```

---

#### POST /api/ai/wikis/:wikiId/reindex

Rebuild embeddings for all files in a wiki.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `wikiId` | path | Wiki ID |
| `include_wiki_pages` | query | Include wiki pages in reindex (default: `true`) |

**Response:**
```json
{
  "ok": true,
  "files_processed": 15,
  "chunks_created": 47
}
```

**curl:**
```bash
curl -X POST "http://localhost:3001/api/ai/wikis/a1b2c3d4/reindex?include_wiki_pages=true"
```

---

#### POST /api/ai/notify

Webhook for agent service to send real-time notifications (broadcasts to WebSocket clients).

**Request Body:**
```json
{
  "event": "ingest:complete",
  "data": {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf",
    "wiki_page": "summaries/document"
  }
}
```

**Response:**
```json
{ "ok": true }
```

---

## Python Agent Service (Port 8000)

Base URL: `http://localhost:8000`

The Agent Service handles AI-powered features using Ollama for LLM/embeddings and ChromaDB for vector storage.

### Endpoint Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| GET | `/wikis` | List registered wikis |
| POST | `/wikis/:id/watch` | Register and watch wiki |
| DELETE | `/wikis/:id/watch` | Stop watching wiki |
| DELETE | `/wikis/:id` | Unregister wiki |
| POST | `/wikis/:id/reindex` | Reindex all documents |
| POST | `/ingest` | Queue file for ingestion |
| GET | `/ingest/queue` | Get queue status |
| GET | `/ingest/history` | Get ingestion history |
| POST | `/wiki/generate` | Generate wiki page |
| GET | `/wiki/status` | Get generation status |
| POST | `/wiki/propose-structure` | AI-propose wiki structure |
| POST | `/wiki/setup` | Create wiki with AI |
| POST | `/search` | Semantic search |
| GET | `/search/suggestions` | Get search suggestions |

---

### Health

#### GET /health

Check service health and dependencies.

**Response:**
```json
{
  "status": "ok",
  "ollama": "ok",
  "chroma": "ok",
  "watchers": 2,
  "wikis": 3
}
```

| Value | Meaning |
|-------|---------|
| `"ok"` | All services operational |
| `"degraded"` | Some services unavailable |
| `"unavailable"` | No services available |

**curl:**
```bash
curl http://localhost:8000/health
```

---

### Wiki Registration

#### GET /wikis

List all wikis registered with the agent service.

**Response:**
```json
[
  {
    "id": "a1b2c3d4",
    "name": "Research Wiki",
    "mode": "wiki",
    "watcher_active": true,
    "chunk_count": 234
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `chunk_count` | number | Number of embedded chunks in ChromaDB |
| `watcher_active` | boolean | Whether file watcher is running |

**curl:**
```bash
curl http://localhost:8000/wikis
```

---

#### POST /wikis/:wiki_id/watch

Register a wiki and start the file watcher.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `wiki_id` | path | Wiki ID |

**Request Body:**
```json
{
  "id": "a1b2c3d4",
  "name": "Research Wiki",
  "path": "/Users/me/wikis/research",
  "color": "#89b4fa",
  "createdAt": "2024-01-15"
}
```

**Response:**
```json
{ "ok": true }
```

**curl:**
```bash
curl -X POST http://localhost:8000/wikis/a1b2c3d4/watch \
  -H "Content-Type: application/json" \
  -d '{"id": "a1b2c3d4", "name": "Research", "path": "/path/to/wiki", "color": "#89b4fa", "createdAt": "2024-01-15"}'
```

---

#### DELETE /wikis/:wiki_id/watch

Stop watching a wiki (keep embeddings).

**Response:**
```json
{ "ok": true }
```

**curl:**
```bash
curl -X DELETE http://localhost:8000/wikis/a1b2c3d4/watch
```

---

#### DELETE /wikis/:wiki_id

Unregister a wiki completely.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `wiki_id` | path | Wiki ID |
| `purge` | query | Delete embeddings from ChromaDB (default: `false`) |

**Response:**
```json
{ "ok": true }
```

**curl:**
```bash
# Keep embeddings
curl -X DELETE http://localhost:8000/wikis/a1b2c3d4

# Purge embeddings
curl -X DELETE "http://localhost:8000/wikis/a1b2c3d4?purge=true"
```

---

#### POST /wikis/:wiki_id/reindex

Re-scan and reindex all documents, replacing existing embeddings.

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `wiki_id` | path | Wiki ID |
| `include_wiki_pages` | query | Include `wiki/` pages (default: `true`) |

**Response:**
```json
{
  "ok": true,
  "files_processed": 15,
  "chunks_created": 234
}
```

**curl:**
```bash
curl -X POST "http://localhost:8000/wikis/a1b2c3d4/reindex?include_wiki_pages=true"
```

---

### Ingestion

#### POST /ingest

Queue a file for processing and embedding.

**Request Body:**
```json
{
  "wiki_id": "a1b2c3d4",
  "file_path": "/Users/me/wikis/research/raw/inbox/document.pdf"
}
```

**Response:**
```json
{
  "ok": true,
  "queued": "/Users/me/wikis/research/raw/inbox/document.pdf"
}
```

**Error Responses:**
- `404 Not Found` - File does not exist

**curl:**
```bash
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{"wiki_id": "a1b2c3d4", "file_path": "/path/to/file.pdf"}'
```

---

#### GET /ingest/queue

Get current processing queue.

**Response:**
```json
[
  {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf",
    "status": "processing",
    "error": null,
    "wiki_page": null,
    "created_at": "2024-03-20T14:30:00Z"
  }
]
```

**curl:**
```bash
curl http://localhost:8000/ingest/queue
```

---

#### GET /ingest/history

Get history of processed files.

**Response:**
```json
[
  {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf",
    "status": "done",
    "error": null,
    "wiki_page": "summaries/document",
    "created_at": "2024-03-20T14:30:00Z"
  }
]
```

**curl:**
```bash
curl http://localhost:8000/ingest/history
```

---

### Wiki Generation

#### POST /wiki/generate

Generate a wiki page from a source file using AI.

**Request Body:**
```json
{
  "wiki_id": "a1b2c3d4",
  "source_file": "/path/to/raw/inbox/document.pdf"
}
```

**Response:**
```json
{ "ok": true }
```

**Error Responses:**
- `404 Not Found` - Wiki not found in `vaults.json`

**curl:**
```bash
curl -X POST http://localhost:8000/wiki/generate \
  -H "Content-Type: application/json" \
  -d '{"wiki_id": "a1b2c3d4", "source_file": "/path/to/file.pdf"}'
```

---

#### GET /wiki/status

Get active wiki generation tasks.

**Response:**
```json
[
  {
    "wiki_id": "a1b2c3d4",
    "source_file": "document.pdf",
    "status": "generating"
  }
]
```

**curl:**
```bash
curl http://localhost:8000/wiki/status
```

---

### Wiki Setup (Create-Wiki Workflow)

#### POST /wiki/propose-structure

AI-generated folder structure proposal based on user's topics.

**Request Body:**
```json
{
  "wiki_name": "AI Research",
  "topics": ["machine learning", "NLP", "computer vision"],
  "source_types": ["papers", "blog posts", "meeting notes"]
}
```

**Response:**
```json
{
  "wiki_name": "AI Research",
  "summary": "A personal wiki for tracking AI/ML research across multiple domains, including papers, blog summaries, and meeting discussions.",
  "folders": [
    { "name": "papers", "description": "Academic papers and preprints" },
    { "name": "articles", "description": "Blog posts and tutorials" },
    { "name": "meetings", "description": "Meeting notes and discussions" },
    { "name": "experiments", "description": "Code experiments and results" }
  ]
}
```

**curl:**
```bash
curl -X POST http://localhost:8000/wiki/propose-structure \
  -H "Content-Type: application/json" \
  -d '{"wiki_name": "AI Research", "topics": ["machine learning"], "source_types": ["papers"]}'
```

---

#### POST /wiki/setup

Create a complete wiki with AI-generated structure.

**Request Body:**
```json
{
  "wiki_name": "AI Research",
  "wiki_path": "/Users/me/wikis",
  "topics": ["machine learning", "NLP"],
  "source_types": ["papers", "blog posts"],
  "folders": [
    { "name": "papers", "description": "Academic papers" },
    { "name": "articles", "description": "Blog posts" }
  ],
  "color": "#89b4fa"
}
```

**Response:**
```json
{
  "ok": true,
  "wiki_id": "abc12345",
  "wiki_path": "/Users/me/wikis/AI Research",
  "files_created": [
    "raw/inbox/",
    "raw/papers/",
    "raw/articles/",
    "wiki/summaries/",
    "wiki/people/",
    "wiki/projects/",
    "wiki/concepts/",
    "wiki.md",
    "wiki/index.md",
    "wiki/log.md",
    "CLAUDE.md",
    ".cursor/rules/wiki-assistant.mdc",
    ".github/copilot-instructions.md"
  ]
}
```

This endpoint:
1. Creates the wiki folder structure
2. Generates `wiki.md` operating manual using AI
3. Creates index and log pages
4. Sets up AI assistant rules for Cursor/VS Code/Claude
5. Registers the wiki in `vaults.json`

**curl:**
```bash
curl -X POST http://localhost:8000/wiki/setup \
  -H "Content-Type: application/json" \
  -d '{
    "wiki_name": "AI Research",
    "wiki_path": "/Users/me/wikis",
    "topics": ["machine learning"],
    "source_types": ["papers"],
    "folders": [{"name": "papers", "description": "Papers"}],
    "color": "#89b4fa"
  }'
```

---

### Search

#### POST /search

Semantic search using vector embeddings.

**Request Body:**
```json
{
  "wiki_id": "a1b2c3d4",
  "query": "What are the key findings about transformer architectures?",
  "top_k": 10
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wiki_id` | string | required | Wiki to search |
| `query` | string | required | Natural language query |
| `top_k` | number | 10 | Max results to return |

**Response:**
```json
{
  "answer": "The key findings about transformer architectures include...",
  "sources": [
    {
      "title": "Attention Is All You Need Summary",
      "file": "raw/papers/attention-paper.pdf",
      "wiki_page": "summaries/attention-paper",
      "excerpt": "...the transformer architecture relies entirely on self-attention mechanisms...",
      "score": 0.92
    }
  ],
  "query_time_ms": 156
}
```

| Field | Type | Description |
|-------|------|-------------|
| `answer` | string | AI-generated answer based on sources |
| `sources` | array | Relevant source documents |
| `sources[].score` | number | Similarity score (0-1) |
| `sources[].wiki_page` | string \| null | Associated wiki page if exists |
| `query_time_ms` | number | Query execution time |

**curl:**
```bash
curl -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -d '{"wiki_id": "a1b2c3d4", "query": "transformer architecture", "top_k": 5}'
```

---

#### GET /search/suggestions

Get search query suggestions (stub endpoint).

**Parameters:**
| Name | In | Description |
|------|-----|-------------|
| `wiki_id` | query | Wiki ID (required) |
| `prefix` | query | Query prefix for autocomplete |

**Response:**
```json
[]
```

**curl:**
```bash
curl "http://localhost:8000/search/suggestions?wiki_id=a1b2c3d4&prefix=trans"
```

---

## WebSocket Events

Connect to: `ws://localhost:3001/ws`

The Express server broadcasts file system changes to connected WebSocket clients.

### Connection Example

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onmessage = (event) => {
  const { event: eventType, data } = JSON.parse(event.data);
  console.log(eventType, data);
};
```

### Events

#### file:add

Fired when a file is added to any watched wiki.

```json
{
  "event": "file:add",
  "data": {
    "path": "/Users/me/wikis/research/raw/inbox/new-file.pdf",
    "wikiId": "a1b2c3d4"
  }
}
```

#### file:change

Fired when a file is modified.

```json
{
  "event": "file:change",
  "data": {
    "path": "/Users/me/wikis/research/wiki/summaries/notes.md",
    "wikiId": "a1b2c3d4"
  }
}
```

#### file:remove

Fired when a file is deleted.

```json
{
  "event": "file:remove",
  "data": {
    "path": "/Users/me/wikis/research/raw/inbox/old-file.pdf",
    "wikiId": "a1b2c3d4"
  }
}
```

### Agent Notifications

The agent service sends notifications via `POST /api/ai/notify`, which are broadcast to all WebSocket clients:

#### ingest:start

```json
{
  "event": "ingest:start",
  "data": {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf"
  }
}
```

#### ingest:complete

```json
{
  "event": "ingest:complete",
  "data": {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf",
    "wiki_page": "summaries/document"
  }
}
```

#### ingest:error

```json
{
  "event": "ingest:error",
  "data": {
    "wiki_id": "a1b2c3d4",
    "file": "document.pdf",
    "error": "Failed to extract text"
  }
}
```

---

## Error Handling

### Standard Error Response

All endpoints return errors in this format:

```json
{
  "error": "Human-readable error message"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (missing/invalid parameters) |
| 404 | Resource not found |
| 422 | Validation error (FastAPI) |
| 500 | Internal server error |
| 503 | Service unavailable (agent not running) |

---

## Authentication

Wiki Explorer is designed for local use and does not include authentication. All endpoints are accessible without credentials.

For production deployments, consider adding a reverse proxy with authentication.
