# Wiki Explorer — Agent Instructions

This is the **wiki-explorer** app: a local React + Express viewer for personal second-brain wikis.

- Frontend: `src/` (React, React Router, Tailwind / Catppuccin theme)
- Server: `server/index.ts` (Express REST API + WebSocket file watcher)
- Wiki template: `wiki-template/` — copied into every new wiki on creation
- Data: `data/vaults.json` — registry of added wikis (path, name, color)

Key conventions:
- All terminology uses "wiki" (not "vault")
- The UI is read-only — no editing of wiki content from the app
- Wiki structure is created by the LLM via `/create-wiki` skill, not by the app
