# Wiki Explorer User Guide

A comprehensive guide to building, installing, and using Wiki Explorer.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Building the App](#building-the-app)
3. [Installing](#installing)
4. [First Run](#first-run)
5. [Adding Wikis](#adding-wikis)
6. [Navigation](#navigation)
7. [AI Features](#ai-features)
8. [Folder Mode](#folder-mode)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
10. [Running from Source](#running-from-source)
11. [Updating](#updating)
12. [Troubleshooting](#troubleshooting)
13. [Uninstalling](#uninstalling)

---

## Prerequisites

The build script **automatically installs** all required dependencies:

- **Node.js** (v18+)
- **Python** (v3.10+)
- **Ollama** (for AI features)
- **Ollama models** (qwen3:8b, nomic-embed-text)

### What You Need

| Platform | Requirements |
|----------|-------------|
| **macOS** | Just run the script — it uses Homebrew (installs if needed) |
| **Windows** | Just run the script — it uses winget or Chocolatey |
| **Linux** | Just run the script — it uses apt/dnf/pacman |

### Manual Installation (Optional)

If you prefer to install prerequisites yourself:

**macOS:**
```bash
brew install node python ollama
```

**Windows:**
```powershell
winget install OpenJS.NodeJS.LTS Python.Python.3.11 Ollama.Ollama
```

### Git

You need Git to clone the repository:

**macOS:**
```bash
xcode-select --install  # Includes Git
```

**Windows:**
```powershell
winget install Git.Git
```

---

## Building the App

### 1. Clone the Repository

```bash
git clone https://github.com/griffin34/wiki-explorer.git
cd wiki-explorer
```

### 2. Run the Build Script

**macOS / Linux:**
```bash
./scripts/build-app.sh
```

**Windows (PowerShell):**
```powershell
.\scripts\build-app.ps1
```

The build script will:
1. **Auto-install prerequisites** (Node.js, Python, Ollama) if missing
2. **Pull Ollama models** (qwen3:8b, nomic-embed-text) if needed
3. Install npm dependencies
4. Build the React frontend
5. Compile TypeScript for Electron
6. Set up the Python virtual environment
7. Install Python dependencies
8. Package the Electron app

> **Note:** First build may take 10-15 minutes to download Ollama models (~5GB).

### 3. Build Output

After a successful build, find your installer in the `app/` folder:

| Platform | File |
|----------|------|
| macOS | `Wiki Explorer-1.0.0-universal.dmg` |
| Windows | `Wiki Explorer Setup-1.0.0.exe` |

---

## Installing

### macOS

1. Open `app/Wiki Explorer-1.0.0-universal.dmg`
2. Drag **Wiki Explorer** to the **Applications** folder

<!-- TODO: Add screenshot of DMG installer -->
![DMG Installer](./images/install-dmg.png)

3. **First launch only**: Right-click the app → **Open** → Click **Open** in the dialog
   
   > This is required because the app isn't signed with an Apple Developer certificate. macOS Gatekeeper blocks unsigned apps by default. You only need to do this once.

### Windows

1. Run `app/Wiki Explorer Setup-1.0.0.exe`
2. Follow the installation wizard
3. Choose installation location (default: `C:\Program Files\Wiki Explorer`)

---

## First Run

When you launch Wiki Explorer for the first time:

<!-- TODO: Add screenshot of first run / empty state -->
![First Run](./images/first-run.png)

### AI Services Auto-Start

The app automatically starts these background services:

| Service | Port | Purpose |
|---------|------|---------|
| ChromaDB | 8001 | Vector database for embeddings |
| Ollama | 11434 | Local LLM inference |
| Agent Service | 8000 | Python AI agents |

The status indicator in the header shows AI availability:
- ⚡ **Green**: All AI services running
- ⚡ **Yellow**: Partially available
- ⚡ **Red**: AI offline

### First Model Download

On first run with AI, Ollama will download required models (~5GB total):
- `qwen3:8b` — Chat/reasoning model
- `nomic-embed-text` — Embedding model for semantic search

This happens automatically but may take several minutes depending on your connection.

---

## Adding Wikis

### Option 1: Add Existing Folder

If you have an existing folder with markdown files:

1. Click **"Add Wiki"** in the sidebar
2. Select your folder
3. Choose a name and color
4. Select mode:
   - **Wiki Mode**: For structured wikis (with `wiki/` and `raw/` folders)
   - **Folder Mode**: For plain markdown folders

<!-- TODO: Add screenshot of add wiki modal -->
![Add Wiki](./images/add-wiki.png)

### Option 2: Create New Wiki

To create a fresh wiki with the recommended structure:

1. Click **"Create Wiki"** in the sidebar
2. Enter a name for your wiki
3. Describe topics you want to cover
4. Review the proposed folder structure
5. Click **Create**

<!-- TODO: Add screenshot of create wiki wizard -->
![Create Wiki Wizard](./images/create-wiki.png)

The wizard creates:
```
your-wiki/
├── wiki/           # Organized markdown pages
│   ├── index.md    # Home page
│   └── [topics]/   # Topic folders
└── raw/
    └── inbox/      # Drop files here for AI processing
```

---

## Navigation

### Sidebar

<!-- TODO: Add screenshot of sidebar -->
![Sidebar](./images/sidebar.png)

| Element | Description |
|---------|-------------|
| Wiki selector | Switch between wikis (dropdown at top) |
| Pages | Browse wiki pages by folder |
| AI Search | Semantic search across your wiki |
| Graph | Interactive knowledge graph |
| Activity | Recent changes log |

### Page View

<!-- TODO: Add screenshot of page view -->
![Page View](./images/page-view.png)

- **Breadcrumbs**: Navigate folder hierarchy
- **Content**: Rendered markdown with syntax highlighting
- **Links**: Click wiki links to navigate between pages

### Graph View

The graph view visualizes connections between your notes:

<!-- TODO: Add screenshot of graph view -->
![Graph View](./images/graph-view.png)

- **Nodes**: Each page is a node
- **Edges**: Links between pages
- **Clustering**: Related pages group together
- **Interaction**: Drag to pan, scroll to zoom, click to open

---

## AI Features

Wiki Explorer includes powerful AI capabilities powered by local models.

### AI Semantic Search

Unlike traditional keyword search, AI search understands meaning:

<!-- TODO: Add screenshot of AI search -->
![AI Search](./images/ai-search.png)

**Example queries:**
- "How do I configure authentication?" (finds relevant pages even without exact keywords)
- "Meeting notes from last week" (understands temporal context)
- "Problems with the database" (matches issues, bugs, errors related to DB)

**How it works:**
1. Your wiki content is converted to vector embeddings using `nomic-embed-text`
2. Embeddings are stored in ChromaDB
3. Your query is also embedded
4. Similar content is found via cosine similarity
5. Results are ranked by relevance

### Inbox Ingestion

Drop files into your wiki's `raw/inbox/` folder for automatic processing:

**Supported formats:**
- PDF documents
- Word documents (.docx)
- PowerPoint presentations (.pptx)
- Excel spreadsheets (.xlsx)
- Outlook emails (.msg)
- Plain text files

**What happens:**
1. AI extracts text content using `markitdown`
2. Content is summarized and converted to markdown
3. New page is created in your wiki
4. Content is indexed for semantic search
5. Original file is archived

<!-- TODO: Add screenshot of inbox processing -->
![Inbox Processing](./images/inbox-processing.png)

### Embedding & Indexing

When you add or modify pages:
1. Content is automatically re-indexed
2. Embeddings are updated in ChromaDB
3. Search results reflect changes immediately

To manually re-index a wiki:
1. Open the wiki
2. Go to Settings (gear icon)
3. Click **"Re-index"**

---

## Folder Mode

For simple markdown folders without the full wiki structure:

<!-- TODO: Add screenshot of folder mode -->
![Folder Mode](./images/folder-mode.png)

**Differences from Wiki Mode:**

| Feature | Wiki Mode | Folder Mode |
|---------|-----------|-------------|
| Structure | `wiki/` + `raw/` folders | Flat or nested markdown |
| Inbox | ✅ `raw/inbox/` for file drops | ❌ Not available |
| Graph view | ✅ Full graph | ❌ Hidden |
| AI Search | ✅ Available | ✅ Available |
| Activity log | ✅ Available | ❌ Hidden |

**When to use Folder Mode:**
- Existing note collections (Obsidian vaults, etc.)
- Simple documentation folders
- When you don't need inbox processing

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Submit AI search query |
| `Esc` | Close modal/dialog |

> Additional keyboard shortcuts are planned for future releases.

---

## Running from Source

For development or if you prefer not to build an installer:

### Start with AI Services

```bash
./run
```

This starts:
- Vite dev server (hot reload)
- Express API server
- ChromaDB
- Ollama
- Python agent service

Open http://localhost:5173 in your browser.

### Start without AI

```bash
./scripts/start.sh      # macOS/Linux
.\scripts\start.ps1     # Windows
```

---

## Updating

### Update the App

```bash
cd wiki-explorer
git pull
./scripts/build-app.sh
```

Then reinstall from the new `app/` output.

### Update Ollama Models

```bash
ollama pull qwen3:8b
ollama pull nomic-embed-text
```

---

## Troubleshooting

### Build Errors

**"Node.js not found"**
```bash
# Verify Node is installed
node --version

# If not installed, see Prerequisites section
```

**"Python not found"**
```bash
# Verify Python is installed
python3 --version

# On Windows, try:
python --version
```

**TypeScript errors**
```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build
```

### AI Services Offline

**Check service status:**
```bash
# ChromaDB
curl http://localhost:8001/api/v1/heartbeat

# Ollama
curl http://localhost:11434/api/tags

# Agent service
curl http://localhost:8000/health
```

**Restart services:**
Close and reopen Wiki Explorer, or:
```bash
# Kill existing services
pkill -f chromadb
pkill -f ollama
pkill -f uvicorn

# Restart
./run
```

### Port Conflicts

If ports are already in use:

| Port | Service | Fix |
|------|---------|-----|
| 5173 | Vite | Kill other Vite instances |
| 3001 | Express | `lsof -i :3001` then kill process |
| 8000 | Agent | `pkill -f uvicorn` |
| 8001 | ChromaDB | `pkill -f chromadb` |

### Ollama Model Issues

**Models not downloading:**
```bash
# Manual pull
ollama pull qwen3:8b
ollama pull nomic-embed-text

# Check available models
ollama list
```

**Out of memory:**
- Close other applications
- Consider using a smaller model (edit `agents/config.py`)

### Search Not Working

1. Check AI status indicator (should be green)
2. Verify wiki is indexed:
   - Open wiki settings
   - Click **"Re-index"**
3. Check agent logs: `~/.ai-logs/agent.log`

---

## Uninstalling

### macOS

1. Drag **Wiki Explorer** from Applications to Trash
2. Optionally remove data:
   ```bash
   # ChromaDB data
   rm -rf ~/.chroma
   
   # Ollama models (warning: removes ALL Ollama models)
   rm -rf ~/.ollama
   ```

### Windows

1. Settings → Apps → Wiki Explorer → Uninstall
2. Optionally remove data:
   ```powershell
   # ChromaDB data
   Remove-Item -Recurse ~\.chroma
   
   # Ollama models
   Remove-Item -Recurse ~\.ollama
   ```

### Your Wiki Data

Your wiki folders are **not** deleted when uninstalling. They remain wherever you created them.
