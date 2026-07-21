# Cloned from https://github.com/griffin34/wiki-explorer and updated to use Starbucks branded colors.

# wiki-explorer

A local web app for browsing and navigating a personal wiki. Point it at a vault directory of markdown files and it gives you a sidebar, a graph view, and full wiki-link support (`[[Page Name]]`) -- no cloud, no accounts, just files.

## Why it was built

My current employer has restricted access to Obsidian so I needed a UI for managing a markdown wiki. When building it, I decided it would be good to have a single place to manage multiple wikis and be agent agnostic.

## What it does

- Renders markdown wiki pages with syntax highlighting and wiki-link navigation
- Shows a live graph of how pages link to each other (via D3)
- Sidebar with search, tag filtering, and page type filtering
- Supports multiple vaults and lets you switch between them
- Watches for file changes and updates in real time (no refresh needed)
- Reads frontmatter (`title`, `type`, `tags`, etc.) to drive filtering and display

When you create a new vault, stub agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are written into it automatically.

## Stack

- React + TypeScript frontend via Vite
- Express backend that reads the local filesystem and serves pages over a REST API
- WebSocket connection for live file-change updates
- D3 for the graph view
- Tailwind for styles

## Getting started

```bash
npm install
npm run dev
```

That starts both the Express server and the Vite dev server concurrently. Open `http://localhost:5173` (or whatever Vite picks).

To point the app at a wiki vault, use the vault selector in the UI or add your vault path to `data/vaults.json`.

## Project layout

```
src/           React components and hooks
server/        Express API + file watcher
data/          Vault registry (vaults.json)
wiki-template/ Starter template for a new wiki vault
```

## To-dos

Still reliant on manual interactions with the LLM (create-wiki, ADD, Tidy Up, ASK) in the IDE of choice. Future iterations will integrate with the user's agent of choice and run completely in the UI.

## References

- [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- [Will Lowrey](https://github.com/bvwill)