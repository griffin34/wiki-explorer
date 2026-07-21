# Wiki Explorer — Electron Packaging Plan

## Overview

Package wiki-explorer as a distributable desktop application while preserving the ability to run as standalone servers for development and headless deployment.

## Goals

1. **Desktop Distribution**: Create native installers for macOS (.app/.dmg) and Windows (.exe)
2. **Dual-Mode Operation**: Support both Electron app mode and standalone server mode
3. **Seamless UX**: Single-click launch with embedded server
4. **Dev Workflow Preserved**: `npm run dev` continues to work as before

---

## Architecture

### Current Architecture
```
┌─────────────────┐     HTTP/WS      ┌─────────────────┐
│   Browser Tab   │ ◄──────────────► │  Express Server │
│   (Vite dev)    │                  │   (port 3001)   │
└─────────────────┘                  └─────────────────┘
```

### Electron Architecture
```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
│  ┌───────────────────┐      ┌────────────────────────┐ │
│  │   Main Process    │      │    Renderer Process    │ │
│  │  (Node.js)        │      │    (Chromium)          │ │
│  │                   │      │                        │ │
│  │  • Express Server │◄────►│  • React UI            │ │
│  │  • WebSocket      │      │  • Loads localhost     │ │
│  │  • File Watcher   │      │                        │ │
│  │  • Native menus   │      │                        │ │
│  └───────────────────┘      └────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Dual-Mode Support
```
npm run dev          → Standalone Vite + Express (current behavior)
npm run start        → Standalone production server (browser)
npm run electron:dev → Electron with hot-reload
npm run electron     → Production Electron app
```

---

## File Structure

```
wiki-explorer/
├── electron/
│   ├── main.ts           # Electron main process entry
│   ├── preload.ts        # Secure bridge for renderer
│   └── menu.ts           # Native menu configuration
├── server/
│   └── index.ts          # Express server (unchanged)
├── src/                   # React app (unchanged)
├── electron-builder.yml  # Build configuration
└── package.json          # Updated scripts
```

---

## Implementation Phases

### Phase 1: Electron Setup (Foundation)
- [ ] Install Electron and electron-builder dependencies
- [ ] Create `electron/main.ts` with BrowserWindow setup
- [ ] Create `electron/preload.ts` for context isolation
- [ ] Add npm scripts for electron dev mode
- [ ] Server spawns inside main process (same Node runtime)

### Phase 2: Server Integration
- [ ] Embed Express server startup in Electron main process
- [ ] Wait for server ready before showing window
- [ ] Handle graceful shutdown on app quit
- [ ] Pass dynamic port to renderer if needed
- [ ] Ensure WebSocket reconnection works

### Phase 3: Production Build
- [ ] Configure electron-builder for macOS and Windows
- [ ] Bundle frontend assets (Vite build output)
- [ ] Bundle server code (compiled TypeScript)
- [ ] Test notarization for macOS (code signing)
- [ ] Create Windows installer configuration

### Phase 4: Polish & UX
- [ ] Add native menu bar (File, Edit, View, Help)
- [ ] Add "Open Wiki Folder" native dialog
- [ ] Add app icon for macOS and Windows
- [ ] Add auto-updater support (optional)
- [ ] Add dock/taskbar badge for notifications (optional)

---

## Technical Specifications

### Dependencies to Add
```json
{
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.13.0",
    "@electron/rebuild": "^3.6.0"
  }
}
```

### electron/main.ts (Skeleton)
```typescript
import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

// Import and start the Express server
let serverModule: typeof import('../server/index')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

async function createWindow() {
  // Start Express server first
  const SERVER_PORT = 3001
  
  // In production, import the bundled server
  // In dev, it runs separately via Vite
  if (!isDev) {
    serverModule = await import('../server/index')
    // Server starts automatically on import
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset', // macOS native feel
    show: false, // Show when ready
  })

  // Load the app
  if (isDev) {
    win.loadURL('http://localhost:5173') // Vite dev server
    win.webContents.openDevTools()
  } else {
    win.loadURL(`http://localhost:${SERVER_PORT}`)
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win.show()
  })

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

### electron-builder.yml
```yaml
appId: com.wiki-explorer.app
productName: Wiki Explorer
copyright: Copyright © 2024

directories:
  output: release
  buildResources: build

files:
  - dist/**/*           # Vite build output
  - server/**/*.js      # Compiled server
  - electron/**/*.js    # Compiled Electron main
  - data/**/*
  - wiki-template/**/*
  - package.json

mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch: [universal]
    - target: zip
      arch: [universal]
  icon: build/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true

linux:
  target:
    - target: AppImage
      arch: [x64]
  category: Office
```

### Package.json Scripts
```json
{
  "scripts": {
    "dev": "concurrently -n server,ui -c cyan,magenta \"npm run dev:server\" \"npm run dev:ui\"",
    "dev:server": "cross-env NODE_ENV=development node --import tsx server/index.ts",
    "dev:ui": "vite",
    "build": "tsc -b && vite build",
    "build:electron": "npm run build && tsc -p tsconfig.electron.json",
    "electron:dev": "concurrently -n server,ui,electron \"npm run dev:server\" \"npm run dev:ui\" \"wait-on http://localhost:5173 && electron .\"",
    "electron": "npm run build:electron && electron .",
    "dist": "npm run build:electron && electron-builder",
    "dist:mac": "npm run build:electron && electron-builder --mac",
    "dist:win": "npm run build:electron && electron-builder --win"
  }
}
```

---

## Server Mode Preservation

The current server mode remains fully functional:

| Command | Description |
|---------|-------------|
| `npm run dev` | Development mode (Vite + Express, hot reload) |
| `npm run build && npm run dev:server` | Production server (serve built assets) |
| `npm run electron:dev` | Electron with hot reload |
| `npm run dist` | Build distributable packages |

### Headless/Server Deployment
For users who want to run wiki-explorer as a web server (no desktop app):
```bash
npm run build
NODE_ENV=production node --import tsx server/index.ts
# Accessible at http://localhost:3001
```

---

## Data & Paths

### Development
- Data directory: `./data/`
- Wiki template: `./wiki-template/`

### Packaged App
- Data directory: `app.getPath('userData')/data/` (portable across installs)
- First-run migration: Copy default `vaults.json` to user data folder
- Wiki template: Bundled in app resources

### Path Resolution Logic
```typescript
function getDataDir(): string {
  if (process.env.WIKI_DATA_DIR) {
    return process.env.WIKI_DATA_DIR // Test override
  }
  if (app?.isPackaged) {
    return path.join(app.getPath('userData'), 'data')
  }
  return path.resolve(__dirname, '../data') // Dev mode
}
```

---

## Open Questions

1. **Python Agents**: The `agents/` folder contains a Python-based AI service. Should this be:
   - Bundled as a sidecar (using PyInstaller)?
   - Left as external dependency (user runs separately)?
   - Removed from desktop build?

2. **Auto-updates**: Include electron-updater for automatic updates?

3. **Code Signing**: 
   - macOS: Requires Apple Developer account ($99/year)
   - Windows: Requires EV code signing certificate (~$300+/year)
   - Skip signing for personal use?

4. **First-Run Experience**: 
   - Should the app prompt to create/add a wiki on first launch?
   - Migration path for existing `data/vaults.json`?

---

## TODO Checklist

### Setup
- [ ] Install Electron dependencies
- [ ] Create `electron/` directory structure
- [ ] Add `tsconfig.electron.json` for Electron TypeScript
- [ ] Create basic `electron/main.ts`
- [ ] Create `electron/preload.ts`
- [ ] Add electron scripts to `package.json`

### Server Integration
- [ ] Modify server to support being imported (not just run)
- [ ] Add server ready callback/event
- [ ] Handle dynamic data directory in packaged app
- [ ] Test WebSocket connection in Electron

### Build Configuration
- [ ] Create `electron-builder.yml`
- [ ] Add build resources folder (`build/`)
- [ ] Create/obtain app icons (`.icns`, `.ico`, `.png`)
- [ ] Test macOS build locally
- [ ] Test Windows build (cross-compile or VM)

### Polish
- [ ] Add native menu bar
- [ ] Add "About" dialog
- [ ] Handle external link clicks
- [ ] Window state persistence (size/position)
- [ ] Error handling for server startup failures

### Documentation
- [ ] Update README with Electron usage
- [ ] Document build requirements
- [ ] Add release workflow instructions
