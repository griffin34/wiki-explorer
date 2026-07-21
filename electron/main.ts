import { app, BrowserWindow, shell, Menu } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, ChildProcess } from 'child_process'

// ESM doesn't have __dirname, so we define it
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null

const SERVER_PORT = 3001
const VITE_PORT = 5173

/**
 * Start the Express server as a child process.
 * In dev mode, we assume the server is already running via `npm run dev`.
 * In production, we spawn the bundled server.
 */
async function startServer(): Promise<void> {
  if (isDev) {
    // In dev mode, server should already be running via `npm run dev`
    console.log('[Electron] Dev mode: expecting server at http://localhost:' + SERVER_PORT)
    return
  }

  // Production: spawn the server process
  const serverPath = path.join(__dirname, '../server/index.js')
  console.log('[Electron] Starting server:', serverPath)
  
  serverProcess = spawn('node', [serverPath], {
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
  })

  serverProcess.on('error', (err) => {
    console.error('[Electron] Server error:', err)
  })

  // Wait for server to be ready
  await waitForServer(`http://localhost:${SERVER_PORT}/api/health`, 30)
}

/**
 * Poll until the server responds or timeout.
 */
async function waitForServer(url: string, maxAttempts: number): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        console.log('[Electron] Server ready')
        return
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn('[Electron] Server did not respond in time, continuing anyway')
}

/**
 * Create the main application window.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset', // macOS native feel
    trafficLightPosition: { x: 16, y: 16 },
    show: false, // Show when ready to avoid flash
    backgroundColor: '#1e1e2e', // Catppuccin base
  })

  // Load the app
  const loadUrl = isDev
    ? `http://localhost:${VITE_PORT}`
    : `http://localhost:${SERVER_PORT}`

  console.log('[Electron] Loading:', loadUrl)
  mainWindow.loadURL(loadUrl)

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Create application menu.
 */
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Wiki…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.executeJavaScript(
              'document.querySelector("[data-add-wiki]")?.click()'
            )
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// App lifecycle
app.whenReady().then(async () => {
  createMenu()
  await startServer()
  createWindow()

  app.on('activate', () => {
    // macOS: re-create window when dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // macOS: apps stay active until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Clean up server process
  if (serverProcess) {
    console.log('[Electron] Stopping server...')
    serverProcess.kill()
    serverProcess = null
  }
})
