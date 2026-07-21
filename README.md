# Wiki Explorer

A local-first personal wiki viewer with AI-powered semantic search. Build your second brain with markdown files and explore it with intelligent search powered by local LLMs.

<!-- TODO: Add screenshot of main view -->
![Wiki Explorer Main View](docs/images/main-view.png)

## Features

- **📚 Personal Wiki Management** — Organize knowledge across multiple wikis with custom colors and names
- **🔍 AI Semantic Search** — Find content by meaning, not just keywords, using local embeddings
- **🕸️ Knowledge Graph** — Visualize connections between your notes with an interactive graph
- **📥 Inbox Ingestion** — Drop files (PDF, DOCX, etc.) into your inbox for automatic processing
- **🎨 Beautiful UI** — Dark mode with Catppuccin theme, clean typography
- **🔒 Fully Local** — All data stays on your machine, no cloud services required
- **⚡ Self-Contained** — Desktop app auto-starts all AI services

## Quick Start

### Prerequisites

Just **Git** to clone the repo — everything else is auto-installed:

```bash
# macOS
xcode-select --install

# Windows
winget install Git.Git
```

The build script automatically installs Node.js, Python, Ollama, and required models.

### Build & Install

```bash
# Clone the repository
git clone https://github.com/griffin34/wiki-explorer.git
cd wiki-explorer

# Build the desktop app (macOS)
./scripts/build-app.sh

# Or on Windows (PowerShell)
.\scripts\build-app.ps1
```

> First build may take 10-15 minutes to download Ollama models (~5GB).

The built app will be in the `app/` folder:
- **macOS**: `Wiki Explorer-x.x.x-universal.dmg`
- **Windows**: `Wiki Explorer Setup-x.x.x.exe`

### Run from Source (Development)

```bash
# Start with AI services
./run

# Or without AI (basic mode)
./scripts/start.sh
```

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](docs/USER-GUIDE.md) | How to use Wiki Explorer |
| [Technical Docs](docs/TECHNICAL.md) | Architecture & developer guide |
| [API Reference](docs/API.md) | REST API documentation |
| [Contributing](docs/CONTRIBUTING.md) | How to contribute |

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Storage | 2 GB | 10 GB (for Ollama models) |
| macOS | 11+ (Big Sur) | 13+ (Ventura) |
| Windows | 10 (64-bit) | 11 |

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend**: Express.js, Node.js
- **Desktop**: Electron
- **AI**: Ollama (qwen3:8b), ChromaDB, nomic-embed-text
- **Python**: FastAPI, markitdown

## License

MIT

## Acknowledgments

- [Ollama](https://ollama.ai/) for local LLM inference
- [ChromaDB](https://www.trychroma.com/) for vector storage
- [Catppuccin](https://github.com/catppuccin) for the beautiful color palette
