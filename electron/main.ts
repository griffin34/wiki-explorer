import { app, BrowserWindow, shell, Menu, dialog, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, ChildProcess, execSync } from 'child_process'
import fs from 'fs'
import net from 'net'

// ESM doesn't have __dirname, so we define it
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let chromaProcess: ChildProcess | null = null
let ollamaProcess: ChildProcess | null = null
let agentProcess: ChildProcess | null = null

// Ports - apiPort is dynamic in production to avoid conflicts
let apiPort = 3001
const VITE_PORT = 5173
const AGENT_PORT = 8000
const CHROMA_PORT = 8001
const OLLAMA_PORT = 11434

// AI service status tracking
interface AIServiceStatus {
  ollama: 'starting' | 'ready' | 'unavailable'
  chroma: 'starting' | 'ready' | 'unavailable'
  agent: 'starting' | 'ready' | 'unavailable'
  overall: 'starting' | 'ready' | 'degraded' | 'unavailable'
}
let aiStatus: AIServiceStatus = {
  ollama: 'starting',
  chroma: 'starting', 
  agent: 'starting',
  overall: 'starting',
}

/**
 * Update splash screen status message
 */
function updateSplashStatus(status: string): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.executeJavaScript(
      `document.getElementById('status').textContent = '${status}'`
    ).catch(() => { /* ignore */ })
  }
}

/**
 * Create the splash screen window
 */
function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 350,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const splashPath = isDev
    ? path.join(__dirname, '..', 'build', 'splash.html')
    : path.join(app.getAppPath(), 'build', 'splash.html')
  
  splashWindow.loadFile(splashPath)
}

/**
 * Close the splash screen
 */
function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
    splashWindow = null
  }
}

/**
 * Find an available port starting from the preferred port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(startPort, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
    server.on('error', () => {
      if (startPort < 65535) {
        resolve(findAvailablePort(startPort + 1))
      } else {
        reject(new Error('No available ports'))
      }
    })
  })
}

/**
 * Get the user data directory for persistent storage
 */
function getUserDataDir(): string {
  return path.join(app.getPath('userData'), 'data')
}

/**
 * Ensure user data directory exists with initial data
 */
function ensureUserData(): void {
  const userDataDir = getUserDataDir()
  const vaultsFile = path.join(userDataDir, 'vaults.json')
  
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }
  
  if (!fs.existsSync(vaultsFile)) {
    fs.writeFileSync(vaultsFile, JSON.stringify({ vaults: [] }, null, 2))
  }
}

/**
 * Find the content root for a wiki (where raw/ and wiki/ directories are).
 * Matches the logic in server/index.ts and agents/ingestion.py
 */
function findContentRoot(wikiPath: string): string | null {
  // Check if raw/ or wiki/ exists directly in wikiPath
  if (fs.existsSync(path.join(wikiPath, 'raw')) || fs.existsSync(path.join(wikiPath, 'wiki'))) {
    return wikiPath
  }
  
  // Check immediate subdirectories
  try {
    const entries = fs.readdirSync(wikiPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subPath = path.join(wikiPath, entry.name)
        if (fs.existsSync(path.join(subPath, 'raw')) || fs.existsSync(path.join(subPath, 'wiki'))) {
          return subPath
        }
      }
    }
  } catch {
    // Ignore errors (permission issues, etc.)
  }
  
  return null
}

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
 * Find node.js executable path.
 * GUI apps on macOS don't inherit shell PATH, so we check common locations.
 */
function findNodePath(): string | null {
  const isWindows = process.platform === 'win32'
  
  if (isWindows) {
    const windowsPaths = [
      `${process.env.PROGRAMFILES}\\nodejs\\node.exe`,
      `${process.env.LOCALAPPDATA}\\Programs\\nodejs\\node.exe`,
      'C:\\Program Files\\nodejs\\node.exe',
    ]
    
    for (const nodePath of windowsPaths) {
      if (nodePath && fs.existsSync(nodePath)) {
        return nodePath
      }
    }
    
    try {
      return execSync('where node', { encoding: 'utf-8' }).trim().split('\n')[0]
    } catch {
      return null
    }
  }
  
  // macOS/Linux paths
  const commonPaths = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    `${process.env.HOME}/.nvm/current/bin/node`,
    `${process.env.HOME}/.local/bin/node`,
    `${process.env.HOME}/.volta/bin/node`,
  ]
  
  for (const nodePath of commonPaths) {
    if (fs.existsSync(nodePath)) {
      return nodePath
    }
  }
  
  // Try which as fallback
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

/**
 * Check if a command exists on the system.
 * For GUI apps on macOS, `which` may not find commands in /usr/local/bin,
 * so we also check common installation paths directly.
 */
function commandExists(cmd: string): boolean {
  // Common paths where commands might be installed (especially on macOS)
  const commonPaths = [
    `/usr/local/bin/${cmd}`,
    `/opt/homebrew/bin/${cmd}`,
    `/usr/bin/${cmd}`,
    `${process.env.HOME}/.local/bin/${cmd}`,
  ]
  
  // Check common paths first (more reliable for GUI apps)
  for (const cmdPath of commonPaths) {
    if (fs.existsSync(cmdPath)) {
      return true
    }
  }
  
  // Fall back to which
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
 * In production: uses embedded mode (no server needed, handled by agent)
 * In development: starts a separate ChromaDB server
 */
async function startChroma(): Promise<void> {
  if (!isDev) {
    // Production: embedded mode - ChromaDB runs inside the agent process
    console.log('[Electron] Production mode: ChromaDB will run embedded in agent')
    aiStatus.chroma = 'ready'  // Will be verified when agent starts
    return
  }
  
  // Development: start separate ChromaDB server
  if (await isPortInUse(CHROMA_PORT)) {
    console.log('[Electron] ChromaDB already running on port', CHROMA_PORT)
    aiStatus.chroma = 'ready'
    return
  }

  const projectRoot = getProjectRoot()
  const isWindows = process.platform === 'win32'
  const venvPython = isWindows
    ? path.join(projectRoot, 'agents', '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, 'agents', '.venv', 'bin', 'python')
  
  if (!fs.existsSync(venvPython)) {
    console.warn('[Electron] Python venv not found, skipping ChromaDB')
    aiStatus.chroma = 'unavailable'
    return
  }

  console.log('[Electron] Starting ChromaDB server...')
  chromaProcess = spawn(venvPython, ['-m', 'chromadb.cli.cli', 'run', '--port', String(CHROMA_PORT), '--path', path.join(projectRoot, '.chroma-data')], {
    cwd: projectRoot,
    stdio: 'pipe',
    env: { ...process.env },
  })

  chromaProcess.stdout?.on('data', (data) => console.log('[ChromaDB]', data.toString().trim()))
  chromaProcess.stderr?.on('data', (data) => console.log('[ChromaDB]', data.toString().trim()))
  chromaProcess.on('error', (err) => {
    console.error('[ChromaDB] Error:', err)
    aiStatus.chroma = 'unavailable'
  })

  // Wait for ChromaDB to be ready (with graceful timeout)
  const ready = await waitForServerWithStatus(`http://localhost:${CHROMA_PORT}/api/v1/heartbeat`, 30)
  if (ready) {
    aiStatus.chroma = 'ready'
    console.log('[Electron] ChromaDB ready')
  } else {
    aiStatus.chroma = 'unavailable'
    console.warn('[Electron] ChromaDB failed to start')
  }
}

/**
 * Find the Ollama binary path
 */
function findOllamaPath(): string | null {
  const isWindows = process.platform === 'win32'
  
  if (isWindows) {
    // Windows paths
    const windowsPaths = [
      `${process.env.LOCALAPPDATA}\\Programs\\Ollama\\ollama.exe`,
      `${process.env.PROGRAMFILES}\\Ollama\\ollama.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Ollama\\ollama.exe`,
    ]
    
    for (const cmdPath of windowsPaths) {
      if (cmdPath && fs.existsSync(cmdPath)) {
        return cmdPath
      }
    }
    
    // Try where as fallback (Windows equivalent of which)
    try {
      return execSync('where ollama', { encoding: 'utf-8' }).trim().split('\n')[0]
    } catch {
      return null
    }
  }
  
  // macOS/Linux paths
  const commonPaths = [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/usr/bin/ollama',
    `${process.env.HOME}/.local/bin/ollama`,
    // macOS Ollama.app internal binary (fallback if CLI symlink not created)
    '/Applications/Ollama.app/Contents/Resources/ollama',
  ]
  
  for (const cmdPath of commonPaths) {
    if (fs.existsSync(cmdPath)) {
      return cmdPath
    }
  }
  
  // Try which as fallback
  try {
    return execSync('which ollama', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

/**
 * Check if Homebrew is installed (macOS)
 */
function findBrewPath(): string | null {
  const brewPaths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
  for (const p of brewPaths) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/**
 * Install Ollama automatically
 * - macOS: Uses Homebrew if available, otherwise downloads official installer
 * - Linux: Uses official install script
 * - Windows: Uses winget if available
 */
async function installOllama(): Promise<boolean> {
  const platform = process.platform
  
  console.log('[Electron] Attempting to install Ollama...')
  updateSplashStatus('Installing Ollama...')
  
  try {
    if (platform === 'darwin') {
      // macOS: prefer Homebrew
      const brewPath = findBrewPath()
      if (brewPath) {
        console.log('[Electron] Installing Ollama via Homebrew...')
        execSync(`${brewPath} install ollama`, { 
          stdio: 'inherit',
          timeout: 300000, // 5 minute timeout
        })
        return true
      } else {
        // Download and open the official DMG
        console.log('[Electron] Homebrew not found, downloading Ollama installer...')
        const downloadUrl = 'https://ollama.com/download/Ollama-darwin.zip'
        const downloadPath = path.join(app.getPath('temp'), 'Ollama-darwin.zip')
        const installPath = '/Applications/Ollama.app'
        
        // Download using curl (available on all macOS)
        execSync(`curl -fsSL -o "${downloadPath}" "${downloadUrl}"`, {
          stdio: 'inherit',
          timeout: 120000, // 2 minute timeout
        })
        
        // Unzip to Applications
        execSync(`unzip -o -q "${downloadPath}" -d /Applications`, {
          stdio: 'inherit',
        })
        
        // Clean up
        fs.unlinkSync(downloadPath)
        
        // Start Ollama app (it installs the CLI and starts the service)
        if (fs.existsSync(installPath)) {
          execSync(`open "${installPath}"`)
          // Wait for Ollama to set up
          await new Promise(r => setTimeout(r, 5000))
          return true
        }
      }
    } else if (platform === 'win32') {
      // Windows: use winget if available
      console.log('[Electron] Installing Ollama via winget...')
      try {
        execSync('winget install --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent', {
          stdio: 'inherit',
          shell: 'cmd.exe',
          timeout: 300000, // 5 minute timeout
        })
        // Refresh PATH to find newly installed ollama
        const newPath = execSync('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', {
          encoding: 'utf-8',
          shell: 'cmd.exe',
        }).trim()
        process.env.PATH = newPath
        return true
      } catch {
        console.warn('[Electron] winget not available or failed')
      }
    } else if (platform === 'linux') {
      // Linux: use official install script
      console.log('[Electron] Installing Ollama via official script...')
      execSync('curl -fsSL https://ollama.com/install.sh | sh', {
        stdio: 'inherit',
        shell: '/bin/bash',
        timeout: 300000, // 5 minute timeout
      })
      return true
    }
  } catch (err) {
    console.error('[Electron] Failed to install Ollama:', err)
  }
  
  return false
}

/**
 * Start Ollama service
 */
async function startOllama(): Promise<void> {
  if (await isPortInUse(OLLAMA_PORT)) {
    console.log('[Electron] Ollama already running on port', OLLAMA_PORT)
    aiStatus.ollama = 'ready'
    return
  }

  let ollamaPath = findOllamaPath()
  
  // Auto-install if not found
  if (!ollamaPath) {
    console.log('[Electron] Ollama not found, attempting installation...')
    const installed = await installOllama()
    if (installed) {
      // Re-check for Ollama after installation
      ollamaPath = findOllamaPath()
    }
  }
  
  if (!ollamaPath) {
    console.warn('[Electron] Ollama installation failed or not available.')
    aiStatus.ollama = 'unavailable'
    return
  }

  console.log('[Electron] Starting Ollama from:', ollamaPath)
  ollamaProcess = spawn(ollamaPath, ['serve'], {
    stdio: 'pipe',
    env: { ...process.env },
  })

  ollamaProcess.stdout?.on('data', (data) => console.log('[Ollama]', data.toString().trim()))
  ollamaProcess.stderr?.on('data', (data) => console.log('[Ollama]', data.toString().trim()))
  ollamaProcess.on('error', (err) => {
    console.error('[Ollama] Error:', err)
    aiStatus.ollama = 'unavailable'
  })

  // Wait for Ollama to be ready (with graceful timeout)
  const ready = await waitForServerWithStatus(`http://localhost:${OLLAMA_PORT}`, 30)
  if (ready) {
    aiStatus.ollama = 'ready'
    console.log('[Electron] Ollama ready')
    // Ensure required models are available (pull in background if missing)
    ensureOllamaModels()
  } else {
    aiStatus.ollama = 'unavailable'
    console.warn('[Electron] Ollama failed to start')
  }
}

/**
 * Ensure required Ollama models are installed (runs in background)
 */
function ensureOllamaModels(): void {
  const requiredModels = ['nomic-embed-text', 'qwen3:8b']
  
  // Check and pull models in background
  ;(async () => {
    try {
      const response = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`)
      const data = await response.json() as { models?: Array<{ name: string }> }
      const installedModels = data.models?.map((m) => m.name) ?? []
      
      for (const model of requiredModels) {
        // Check if model is installed (may have :latest suffix)
        const isInstalled = installedModels.some((m) => 
          m === model || m.startsWith(model + ':') || m === model + ':latest'
        )
        
        if (!isInstalled) {
          console.log(`[Electron] Pulling Ollama model: ${model}`)
          const pullProcess = spawn('ollama', ['pull', model], { stdio: 'inherit' })
          await new Promise<void>((resolve) => {
            pullProcess.on('close', () => resolve())
            pullProcess.on('error', () => resolve())
          })
        }
      }
    } catch (err) {
      console.warn('[Electron] Could not check/pull Ollama models:', err)
    }
  })()
}

/**
 * Start Python agent service
 * In dev: uses Python venv
 * In production: uses bundled PyInstaller executable
 */
async function startAgentService(): Promise<void> {
  if (await isPortInUse(AGENT_PORT)) {
    console.log('[Electron] Agent service already running on port', AGENT_PORT)
    aiStatus.agent = 'ready'
    return
  }

  let agentCommand: string
  let agentArgs: string[]
  let agentCwd: string
  
  if (isDev) {
    // Development: use Python venv
    const projectRoot = getProjectRoot()
    const isWindows = process.platform === 'win32'
    const venvPython = isWindows
      ? path.join(projectRoot, 'agents', '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'agents', '.venv', 'bin', 'python')
    const mainPy = path.join(projectRoot, 'agents', 'main.py')
    
    if (!fs.existsSync(venvPython)) {
      console.warn('[Electron] Python venv not found, skipping agent service')
      aiStatus.agent = 'unavailable'
      return
    }
    
    agentCommand = venvPython
    agentArgs = [mainPy]
    agentCwd = path.join(projectRoot, 'agents')
  } else {
    // Production: use bundled PyInstaller executable
    const resourcesPath = process.resourcesPath || path.join(app.getAppPath(), '..')
    const isWindows = process.platform === 'win32'
    const execName = isWindows ? 'wiki-agent.exe' : 'wiki-agent'
    const agentExecutable = path.join(resourcesPath, 'agent', execName)
    
    if (!fs.existsSync(agentExecutable)) {
      console.warn('[Electron] Bundled agent not found at:', agentExecutable)
      aiStatus.agent = 'unavailable'
      return
    }
    
    agentCommand = agentExecutable
    agentArgs = []
    agentCwd = path.join(resourcesPath, 'agent')
  }

  // Set up environment variables
  const agentEnv: NodeJS.ProcessEnv = { 
    ...process.env,
    PYTHONUNBUFFERED: '1',
  }
  
  // Production: use embedded ChromaDB mode
  if (!isDev) {
    const userDataDir = getUserDataDir()
    agentEnv.CHROMA_EMBEDDED = 'true'
    agentEnv.CHROMA_PATH = path.join(userDataDir, 'chroma')
    agentEnv.VAULTS_FILE = path.join(userDataDir, 'vaults.json')
  }

  console.log('[Electron] Starting agent service:', agentCommand)
  agentProcess = spawn(agentCommand, agentArgs, {
    cwd: agentCwd,
    stdio: 'pipe',
    env: agentEnv,
  })

  agentProcess.stdout?.on('data', (data) => console.log('[Agent]', data.toString().trim()))
  agentProcess.stderr?.on('data', (data) => console.log('[Agent]', data.toString().trim()))
  agentProcess.on('error', (err) => {
    console.error('[Agent] Error:', err)
    aiStatus.agent = 'unavailable'
  })

  // Wait for agent to be ready (with graceful timeout)
  const ready = await waitForServerWithStatus(`http://localhost:${AGENT_PORT}/health`, 30)
  if (ready) {
    aiStatus.agent = 'ready'
    console.log('[Electron] Agent service ready')
  } else {
    aiStatus.agent = 'unavailable'
    console.warn('[Electron] Agent service failed to start')
  }
}

/**
 * Update the overall AI status based on individual service states
 */
function updateOverallAIStatus(): void {
  const services = [aiStatus.ollama, aiStatus.chroma, aiStatus.agent]
  
  if (services.every(s => s === 'ready')) {
    aiStatus.overall = 'ready'
  } else if (services.every(s => s === 'unavailable')) {
    aiStatus.overall = 'unavailable'
  } else if (services.some(s => s === 'starting')) {
    aiStatus.overall = 'starting'
  } else {
    aiStatus.overall = 'degraded'
  }
}

/**
 * Start all AI services
 */
async function startAIServices(): Promise<void> {
  console.log('[Electron] Starting AI services...')
  
  updateSplashStatus('Checking ChromaDB...')
  await startChroma()
  updateSplashStatus('Starting Ollama...')
  await startOllama()
  updateSplashStatus('Starting agent service...')
  await startAgentService()
  
  // Update overall status
  updateOverallAIStatus()
  console.log('[Electron] AI services status:', aiStatus.overall)
  
  // Log individual statuses
  console.log(`[Electron] - Ollama: ${aiStatus.ollama}`)
  console.log(`[Electron] - ChromaDB: ${aiStatus.chroma}`)
  console.log(`[Electron] - Agent: ${aiStatus.agent}`)
}

/**
 * Start the Express server as a child process.
 * In dev mode, we assume the server is already running via `npm run dev`.
 * In production, we spawn the bundled server on a dynamic port.
 */
async function startServer(): Promise<void> {
  if (isDev) {
    // In dev mode, server should already be running via `npm run dev`
    console.log('[Electron] Dev mode: expecting server at http://localhost:' + apiPort)
    return
  }

  // Find an available port for the API server
  try {
    apiPort = await findAvailablePort(3001)
    console.log(`[Electron] Using port ${apiPort} for API server`)
  } catch (err) {
    console.error('[Electron] Failed to find available port:', err)
  }

  // Ensure user data directory exists
  ensureUserData()
  const userDataDir = getUserDataDir()

  // Production: spawn the bundled server
  const appPath = app.getAppPath()
  const unpackedPath = appPath.endsWith('.asar')
    ? appPath.replace('.asar', '.asar.unpacked')
    : appPath
  const serverPath = path.join(unpackedPath, 'dist-server', 'index.cjs')
  const wikiTemplatePath = path.join(unpackedPath, 'wiki-template')
  const frontendPath = path.join(unpackedPath, 'dist')
  
  // Find node executable - GUI apps don't inherit shell PATH
  const nodePath = findNodePath()
  if (!nodePath) {
    console.error('[Electron] Node.js not found, cannot start server')
    return
  }
  
  console.log('[Electron] Starting server:', serverPath)
  console.log('[Electron] Using node:', nodePath)
  console.log('[Electron] Data directory:', userDataDir)
  console.log('[Electron] Frontend directory:', frontendPath)
  
  serverProcess = spawn(nodePath, [serverPath], {
    env: { 
      ...process.env, 
      NODE_ENV: 'production',
      PORT: String(apiPort),
      WIKI_DATA_DIR: userDataDir,
      WIKI_TEMPLATE_DIR: wikiTemplatePath,
      WIKI_FRONTEND_DIR: frontendPath,
    },
    stdio: 'pipe',
    cwd: unpackedPath,
  })
  
  serverProcess.stdout?.on('data', (data) => console.log('[Server]', data.toString().trim()))
  serverProcess.stderr?.on('data', (data) => console.error('[Server]', data.toString().trim()))

  serverProcess.on('error', (err) => {
    console.error('[Electron] Server error:', err)
  })
  
  serverProcess.on('exit', (code) => {
    console.error('[Electron] Server exited with code:', code)
  })

  // Wait for server to be ready (API endpoint)
  console.log('[Electron] Waiting for server to be ready...')
  await waitForServer(`http://localhost:${apiPort}/api/wikis`, 60)
  
  // Extra delay to ensure server is fully stable
  await new Promise(r => setTimeout(r, 500))
  console.log('[Electron] Server startup complete')
}

/**
 * Poll until the server responds or timeout.
 */
async function waitForServer(url: string, maxAttempts: number): Promise<void> {
  console.log(`[Electron] Polling ${url} (max ${maxAttempts} attempts)...`)
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        console.log(`[Electron] Server ready at ${url} (attempt ${i + 1})`)
        return
      }
      console.log(`[Electron] Server returned ${response.status}, retrying...`)
    } catch (err) {
      if (i % 10 === 0) {
        console.log(`[Electron] Waiting for server... (attempt ${i + 1}/${maxAttempts})`)
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.warn('[Electron] Server did not respond in time, continuing anyway')
}

/**
 * Poll until the server responds or timeout. Returns success status.
 */
async function waitForServerWithStatus(url: string, maxAttempts: number): Promise<boolean> {
  console.log(`[Electron] Polling ${url} (max ${maxAttempts} attempts)...`)
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        console.log(`[Electron] Server ready at ${url} (attempt ${i + 1})`)
        return true
      }
    } catch {
      // Service not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset', // macOS native feel
    trafficLightPosition: { x: 16, y: 16 },
    show: false, // Show when ready to avoid flash
    backgroundColor: '#1e1e2e', // Catppuccin base
  })

  // Load the app from the API server (serves static files)
  const loadUrl = isDev 
    ? `http://localhost:${VITE_PORT}` 
    : `http://localhost:${apiPort}`
  console.log('[Electron] Loading:', loadUrl)
  
  // Track load attempts for retry logic
  let loadAttempts = 0
  const maxLoadAttempts = 3
  
  const tryLoad = () => {
    loadAttempts++
    console.log(`[Electron] Load attempt ${loadAttempts}/${maxLoadAttempts}`)
    mainWindow?.loadURL(loadUrl)
  }
  
  // Handle load failures - retry a few times
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Electron] Failed to load: ${errorCode} - ${errorDescription}`)
    if (loadAttempts < maxLoadAttempts) {
      console.log('[Electron] Retrying in 2 seconds...')
      setTimeout(tryLoad, 2000)
    }
  })
  
  // Verify server is reachable before first load
  console.log('[Electron] Verifying server before load...')
  fetch(loadUrl).then(() => {
    console.log('[Electron] Server verified, starting load')
    tryLoad()
  }).catch(() => {
    console.log('[Electron] Server not ready, waiting 2 seconds...')
    setTimeout(tryLoad, 2000)
  })

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    // Close splash and show main window
    closeSplash()
    mainWindow?.show()
  })
  
  // Log renderer console messages to main process
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = ['verbose', 'info', 'warning', 'error'][level] || 'log'
    console.log(`[Renderer ${levelName}] ${message}`)
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
  // Show splash screen immediately
  createSplashWindow()
  
  createMenu()
  
  // IPC handler for frontend to get API URL
  ipcMain.handle('get-api-url', () => `http://localhost:${apiPort}`)
  
  // IPC handler for frontend to get AI service status
  ipcMain.handle('get-ai-status', () => aiStatus)
  
  // IPC handler to open inbox folder in Finder (for Outlook drag workaround)
  ipcMain.handle('open-inbox-folder', async (_event, wikiPath: string) => {
    // Try to find the content root and inbox
    const contentRoot = findContentRoot(wikiPath)
    const inboxPath = contentRoot 
      ? path.join(contentRoot, 'raw', 'inbox')
      : path.join(wikiPath, 'raw', 'inbox')
    
    // Ensure inbox exists
    if (!fs.existsSync(inboxPath)) {
      fs.mkdirSync(inboxPath, { recursive: true })
    }
    
    shell.openPath(inboxPath)
  })
  
  // IPC handler to reveal a file/folder in Finder
  ipcMain.handle('reveal-in-finder', async (_event, filePath: string) => {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })
  
  // Start all services with status updates
  updateSplashStatus('Starting AI services...')
  await startAIServices()
  
  updateSplashStatus('Starting server...')
  await startServer()
  
  updateSplashStatus('Loading interface...')
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
