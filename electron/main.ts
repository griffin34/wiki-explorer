import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, ChildProcess, execSync } from 'child_process'
import fs from 'fs'

// ESM doesn't have __dirname, so we define it
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let chromaProcess: ChildProcess | null = null
let ollamaProcess: ChildProcess | null = null
let agentProcess: ChildProcess | null = null

const SERVER_PORT = 3001
const VITE_PORT = 5173
const AGENT_PORT = 8000
const CHROMA_PORT = 8001
const OLLAMA_PORT = 11434

/**
 * Get the project root directory
 */
function getProjectRoot(): string {
  if (isDev) {
    return path.resolve(__dirname, '..')
  }
  // In production, resources are in app.asar or extraResources
  return path.resolve(app.getAppPath(), '..')
}

/**
 * Check if a command exists on the system
 */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Check if a port is in use
 */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`)
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

/**
 * Start ChromaDB service
 */
async function startChroma(): Promise<void> {
  if (await isPortInUse(CHROMA_PORT)) {
    console.log('[Electron] ChromaDB already running on port', CHROMA_PORT)
    return
  }

  const projectRoot = getProjectRoot()
  const venvPython = path.join(projectRoot, 'agents', '.venv', 'bin', 'python')
  
  if (!fs.existsSync(venvPython)) {
    console.warn('[Electron] Python venv not found, skipping ChromaDB')
    return
  }

  console.log('[Electron] Starting ChromaDB...')
  chromaProcess = spawn(venvPython, ['-m', 'chromadb.cli.cli', 'run', '--port', String(CHROMA_PORT), '--path', path.join(projectRoot, '.chroma-data')], {
    cwd: projectRoot,
    stdio: 'pipe',
    env: { ...process.env },
  })

  chromaProcess.stdout?.on('data', (data) => console.log('[ChromaDB]', data.toString().trim()))
  chromaProcess.stderr?.on('data', (data) => console.log('[ChromaDB]', data.toString().trim()))
  chromaProcess.on('error', (err) => console.error('[ChromaDB] Error:', err))

  // Wait for ChromaDB to be ready
  await waitForServer(`http://localhost:${CHROMA_PORT}/api/v1/heartbeat`, 30)
  console.log('[Electron] ChromaDB ready')
}

/**
 * Start Ollama service
 */
async function startOllama(): Promise<void> {
  if (await isPortInUse(OLLAMA_PORT)) {
    console.log('[Electron] Ollama already running on port', OLLAMA_PORT)
    return
  }

  if (!commandExists('ollama')) {
    console.warn('[Electron] Ollama not installed. AI features will be limited.')
    dialog.showMessageBox({
      type: 'warning',
      title: 'Ollama Not Found',
      message: 'Ollama is not installed. AI search and wiki generation will not work.',
      detail: 'Install Ollama from https://ollama.ai to enable AI features.',
      buttons: ['OK'],
    })
    return
  }

  console.log('[Electron] Starting Ollama...')
  ollamaProcess = spawn('ollama', ['serve'], {
    stdio: 'pipe',
    env: { ...process.env },
  })

  ollamaProcess.stdout?.on('data', (data) => console.log('[Ollama]', data.toString().trim()))
  ollamaProcess.stderr?.on('data', (data) => console.log('[Ollama]', data.toString().trim()))
  ollamaProcess.on('error', (err) => console.error('[Ollama] Error:', err))

  // Wait for Ollama to be ready
  await waitForServer(`http://localhost:${OLLAMA_PORT}`, 30)
  console.log('[Electron] Ollama ready')
}

/**
 * Start Python agent service
 */
async function startAgentService(): Promise<void> {
  if (await isPortInUse(AGENT_PORT)) {
    console.log('[Electron] Agent service already running on port', AGENT_PORT)
    return
  }

  const projectRoot = getProjectRoot()
  const venvPython = path.join(projectRoot, 'agents', '.venv', 'bin', 'python')
  const mainPy = path.join(projectRoot, 'agents', 'main.py')
  
  if (!fs.existsSync(venvPython)) {
    console.warn('[Electron] Python venv not found, skipping agent service')
    return
  }

  console.log('[Electron] Starting agent service...')
  agentProcess = spawn(venvPython, [mainPy], {
    cwd: path.join(projectRoot, 'agents'),
    stdio: 'pipe',
    env: { 
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  })

  agentProcess.stdout?.on('data', (data) => console.log('[Agent]', data.toString().trim()))
  agentProcess.stderr?.on('data', (data) => console.log('[Agent]', data.toString().trim()))
  agentProcess.on('error', (err) => console.error('[Agent] Error:', err))

  // Wait for agent to be ready
  await waitForServer(`http://localhost:${AGENT_PORT}/health`, 30)
  console.log('[Electron] Agent service ready')
}

/**
 * Start all AI services
 */
async function startAIServices(): Promise<void> {
  console.log('[Electron] Starting AI services...')
  
  try {
    await startChroma()
    await startOllama()
    await startAgentService()
    console.log('[Electron] AI services started')
  } catch (err) {
    console.error('[Electron] Failed to start some AI services:', err)
  }
}

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
    // DevTools can be toggled via View menu (Cmd+Opt+I)
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
  
  // Start all services
  await startAIServices()
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
  console.log('[Electron] Shutting down services...')
  
  // Clean up all processes
  if (agentProcess) {
    console.log('[Electron] Stopping agent service...')
    agentProcess.kill()
    agentProcess = null
  }
  
  if (chromaProcess) {
    console.log('[Electron] Stopping ChromaDB...')
    chromaProcess.kill()
    chromaProcess = null
  }
  
  // Note: We don't kill Ollama as it may be used by other apps
  // and it's a system service that should persist
  
  if (serverProcess) {
    console.log('[Electron] Stopping server...')
    serverProcess.kill()
    serverProcess = null
  }
  
  console.log('[Electron] All services stopped')
})
