import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import chokidar from 'chokidar'
import matter from 'gray-matter'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const VAULTS_FILE = path.join(DATA_DIR, 'vaults.json')
const WIKI_TEMPLATE_DIR = path.resolve(__dirname, '../wiki-template')

// ─── Wiki Config ──────────────────────────────────────────────────────────────

interface WikiConfig {
  id: string
  name: string
  path: string
  color: string
  createdAt: string
}

function loadWikis(): WikiConfig[] {
  try {
    const raw = fs.readFileSync(VAULTS_FILE, 'utf-8')
    return (JSON.parse(raw) as { vaults: WikiConfig[] }).vaults ?? []
  } catch {
    return []
  }
}

function saveWikis(wikis: WikiConfig[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(VAULTS_FILE, JSON.stringify({ vaults: wikis }, null, 2))
}

function getWiki(id: string): WikiConfig | undefined {
  return loadWikis().find((v) => v.id === id)
}

const SKIP_COPY = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'ehthumbs.db'])

function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_COPY.has(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ─── Wiki Path Helpers ────────────────────────────────────────────────────────

// The LLM creates a named subfolder inside the registered path, so the real
// content root may be one level down (e.g. <path>/<wiki-name>/raw/inbox).
// These helpers scan up to 1 level deep to find the actual content root.
function findContentRoot(v: WikiConfig): string | null {
  // Direct match: raw/ or wiki/ sit right at v.path
  if (fs.existsSync(path.join(v.path, 'raw')) || fs.existsSync(path.join(v.path, 'wiki'))) {
    return v.path
  }
  // One level down: look for a subdirectory that contains raw/ or wiki/
  try {
    const entries = fs.readdirSync(v.path, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const sub = path.join(v.path, e.name)
      if (fs.existsSync(path.join(sub, 'raw')) || fs.existsSync(path.join(sub, 'wiki'))) {
        return sub
      }
    }
  } catch { /* ignore */ }
  return null
}

// Returns true when the folder has a proper wiki/raw directory structure.
// Plain markdown folders (no wiki/ or raw/) use "folder" mode instead.
const isWikiMode = (v: WikiConfig): boolean => findContentRoot(v) !== null

const wikiDir = (v: WikiConfig) => path.join(findContentRoot(v) ?? v.path, 'wiki')
const inboxDir = (v: WikiConfig) => {
  const root = findContentRoot(v)
  return root ? path.join(root, 'raw', 'inbox') : null
}
const rawDir = (v: WikiConfig) => {
  const root = findContentRoot(v)
  return root ? path.join(root, 'raw') : null
}

// Base directory used to compute page IDs for each mode
const pageBaseDir = (v: WikiConfig): string =>
  isWikiMode(v) ? wikiDir(v) : v.path

// ─── File Utilities ───────────────────────────────────────────────────────────

function safeRead(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8') } catch { return null }
}

function getAllMdFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) results.push(full)
    }
  }
  walk(dir)
  return results
}

function getAllRawFiles(v: WikiConfig): string[] {
  const results: string[] = []
  for (const dir of [inboxDir(v), rawDir(v)]) {
    if (!dir || !fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const p = path.join(dir, entry.name)
        if (!results.includes(p)) results.push(p)
      }
    }
  }
  return results
}

function extractLinks(content: string): string[] {
  const links: string[] = []
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) links.push(m[1].trim())
  return [...new Set(links)]
}

function pageIdFromPath(filePath: string, v: WikiConfig): string {
  return path.relative(pageBaseDir(v), filePath)
    .replace(/\.md$/, '')
    .replace(/\\/g, '/')   // normalize Windows backslashes → forward slashes for URLs
}

// ─── Wiki Stats ───────────────────────────────────────────────────────────────

function wikiStats(v: WikiConfig) {
  const wikiMode = isWikiMode(v)
  const pages = getAllMdFiles(wikiMode ? wikiDir(v) : v.path)
  const sources = wikiMode ? getAllRawFiles(v) : []
  const logPath = path.join(wikiDir(v), 'log.md')
  let lastActivity = v.createdAt
  if (fs.existsSync(logPath)) {
    const stat = fs.statSync(logPath)
    lastActivity = stat.mtime.toISOString().split('T')[0]
  }
  return { pageCount: pages.length, sourceCount: sources.length, lastActivity }
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// ─── IDE Detection & Launch ───────────────────────────────────────────────────

interface IDEInfo {
  id: string
  name: string
}

async function commandExists(cmd: string): Promise<boolean> {
  const check = process.platform === 'win32' ? `where "${cmd}"` : `which "${cmd}"`
  try { await execAsync(check); return true } catch { return false }
}

/** Expand common Windows env vars in a path string */
function winExpand(p: string): string {
  return p
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? '')
    .replace(/%APPDATA%/gi, process.env.APPDATA ?? '')
    .replace(/%PROGRAMFILES%/gi, process.env.PROGRAMFILES ?? 'C:\\Program Files')
    .replace(/%PROGRAMFILES\(X86\)%/gi, process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE ?? '')
}

/** Find the first existing file from a list of candidate paths (Windows, supports env vars) */
function findWinExe(candidates: string[]): string | null {
  for (const c of candidates) {
    const expanded = winExpand(c)
    if (fs.existsSync(expanded)) return expanded
  }
  return null
}

/** Search JetBrains Toolbox app dirs for an exe matching a glob-like prefix */
function findJetBrainsExe(appDirPrefix: string, exeName: string): string | null {
  const toolboxApps = winExpand('%LOCALAPPDATA%\\JetBrains\\Toolbox\\apps')
  if (!fs.existsSync(toolboxApps)) return null
  try {
    const entries = fs.readdirSync(toolboxApps)
    const match = entries.find((e) => e.toLowerCase().startsWith(appDirPrefix.toLowerCase()))
    if (!match) return null
    // Toolbox structure: apps/<AppDir>/ch-0/<build>/bin/<exe>
    const appRoot = path.join(toolboxApps, match, 'ch-0')
    if (!fs.existsSync(appRoot)) return null
    const builds = fs.readdirSync(appRoot).sort().reverse() // newest build first
    for (const build of builds) {
      const candidate = path.join(appRoot, build, 'bin', exeName)
      if (fs.existsSync(candidate)) return candidate
    }
  } catch { /* ignore */ }
  return null
}

// IDE definitions — detection candidates + launch strategy per platform
const IDE_DEFS: Array<{
  id: string
  name: string
  mac: { apps: string[]; macAppName: string; cli: string }
  win: { exes: string[]; cli: string; toolboxPrefix?: string; toolboxExe?: string }
  linux: { cli: string }
}> = [
  {
    id: 'cursor',
    name: 'Cursor',
    mac: { apps: ['/Applications/Cursor.app'], macAppName: 'Cursor', cli: 'cursor' },
    win: { exes: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe', '%USERPROFILE%\\AppData\\Local\\Programs\\cursor\\Cursor.exe'], cli: 'cursor' },
    linux: { cli: 'cursor' },
  },
  {
    id: 'vscode',
    name: 'VS Code',
    mac: { apps: ['/Applications/Visual Studio Code.app'], macAppName: 'Visual Studio Code', cli: 'code' },
    win: { exes: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe', '%PROGRAMFILES%\\Microsoft VS Code\\Code.exe'], cli: 'code' },
    linux: { cli: 'code' },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    mac: { apps: ['/Applications/Windsurf.app'], macAppName: 'Windsurf', cli: 'windsurf' },
    win: { exes: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe', '%LOCALAPPDATA%\\Programs\\windsurf\\Windsurf.exe'], cli: 'windsurf' },
    linux: { cli: 'windsurf' },
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    mac: { apps: ['/Applications/IntelliJ IDEA.app', '/Applications/IntelliJ IDEA CE.app', '/Applications/IntelliJ IDEA Ultimate.app'], macAppName: 'IntelliJ IDEA', cli: 'idea' },
    win: { exes: ['%PROGRAMFILES%\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe'], cli: 'idea', toolboxPrefix: 'IDEA', toolboxExe: 'idea64.exe' },
    linux: { cli: 'idea' },
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    mac: { apps: ['/Applications/WebStorm.app'], macAppName: 'WebStorm', cli: 'webstorm' },
    win: { exes: ['%PROGRAMFILES%\\JetBrains\\WebStorm\\bin\\webstorm64.exe'], cli: 'webstorm', toolboxPrefix: 'WebStorm', toolboxExe: 'webstorm64.exe' },
    linux: { cli: 'webstorm' },
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    mac: { apps: ['/Applications/PyCharm.app', '/Applications/PyCharm CE.app', '/Applications/PyCharm Professional Edition.app'], macAppName: 'PyCharm', cli: 'pycharm' },
    win: { exes: ['%PROGRAMFILES%\\JetBrains\\PyCharm\\bin\\pycharm64.exe', '%PROGRAMFILES%\\JetBrains\\PyCharm Community Edition\\bin\\pycharm64.exe'], cli: 'pycharm', toolboxPrefix: 'PyCharm', toolboxExe: 'pycharm64.exe' },
    linux: { cli: 'pycharm' },
  },
]

app.get('/api/detect-ides', async (_req, res) => {
  const detected: IDEInfo[] = []

  for (const def of IDE_DEFS) {
    let found = false

    if (process.platform === 'darwin') {
      found = def.mac.apps.some((p) => fs.existsSync(p)) || await commandExists(def.mac.cli)
    } else if (process.platform === 'win32') {
      const exeFound = findWinExe(def.win.exes) !== null
      const toolboxFound = def.win.toolboxPrefix
        ? findJetBrainsExe(def.win.toolboxPrefix, def.win.toolboxExe!) !== null
        : false
      found = exeFound || toolboxFound || await commandExists(def.win.cli)
    } else {
      found = await commandExists(def.linux.cli)
    }

    if (found) detected.push({ id: def.id, name: def.name })
  }

  res.json(detected)
})

app.post('/api/open-in-ide', async (req, res) => {
  const { ide, path: folderPath } = req.body as { ide?: string; path?: string }
  if (!ide || !folderPath) return res.status(400).json({ error: 'ide and path are required' })

  const def = IDE_DEFS.find((d) => d.id === ide)
  if (!def) return res.status(400).json({ error: `Unknown IDE: ${ide}` })

  try {
    if (process.platform === 'darwin') {
      // Prefer app bundle via `open -a`; fall back to CLI on PATH
      const appExists = def.mac.apps.some((p) => fs.existsSync(p))
      if (appExists) {
        await execAsync(`open -a "${def.mac.macAppName}" "${folderPath}"`)
      } else {
        await execAsync(`${def.mac.cli} "${folderPath}"`)
      }
    } else if (process.platform === 'win32') {
      // Prefer absolute exe path (quoted); fall back to bare CLI name on PATH
      const exePath = findWinExe(def.win.exes)
        ?? (def.win.toolboxPrefix ? findJetBrainsExe(def.win.toolboxPrefix, def.win.toolboxExe!) : null)
      if (exePath) {
        await execAsync(`"${exePath}" "${folderPath}"`)
      } else {
        // Bare command name — do not wrap in quotes so cmd.exe can find it on PATH
        await execAsync(`${def.win.cli} "${folderPath}"`)
      }
    } else {
      await execAsync(`${def.linux.cli} "${folderPath}"`)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─── Native Folder Picker ─────────────────────────────────────────────────────

app.get('/api/pick-folder', async (_req, res) => {
  try {
    let folderPath: string

    if (process.platform === 'darwin') {
      const { stdout } = await execAsync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select a folder for your wiki:")'`
      )
      folderPath = stdout.trim().replace(/\/$/, '')
    } else if (process.platform === 'win32') {
      // Use -EncodedCommand to avoid cmd.exe quoting conflicts entirely
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$d.Description = 'Select a folder for your wiki'",
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
      ].join('; ')
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
      const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`)
      folderPath = stdout.trim()
    } else {
      // Linux fallback — try zenity, then kdialog
      try {
        const { stdout } = await execAsync('zenity --file-selection --directory --title="Select a folder for your wiki"')
        folderPath = stdout.trim()
      } catch {
        const { stdout } = await execAsync('kdialog --getexistingdirectory "$HOME"')
        folderPath = stdout.trim()
      }
    }

    if (!folderPath) return res.status(400).json({ error: 'No folder selected' })
    res.json({ path: folderPath })
  } catch (err: unknown) {
    const msg = String(err)
    // User cancelled — osascript exits with code 1 and says "User canceled"
    if (msg.includes('cancel') || msg.includes('Cancel') || msg.includes('(-128)')) {
      return res.status(400).json({ error: 'cancelled' })
    }
    res.status(500).json({ error: msg })
  }
})

// ─── Wiki Management API ──────────────────────────────────────────────────────

app.get('/api/wikis', (_req, res) => {
  const wikis = loadWikis()
  const result = wikis.map((v) => ({
    ...v,
    mode: isWikiMode(v) ? 'wiki' : 'folder',
    stats: wikiStats(v),
  }))
  res.json(result)
})

app.post('/api/wikis', (req, res) => {
  const { name, wikiPath, color, create } = req.body as {
    name?: string
    wikiPath?: string
    color?: string
    create?: boolean
  }
  if (!name?.trim() || !wikiPath?.trim()) {
    return res.status(400).json({ error: 'name and wikiPath are required' })
  }

  // When creating, treat wikiPath as the *parent* folder and append a slug of the name
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const absPath = create
    ? path.resolve(path.join(wikiPath.trim(), slug))
    : path.resolve(wikiPath.trim())

  if (create) {
    fs.mkdirSync(absPath, { recursive: true })
    // Seed from wiki-template if it exists
    if (fs.existsSync(WIKI_TEMPLATE_DIR)) {
      copyDirRecursive(WIKI_TEMPLATE_DIR, absPath)
    }
  } else {
    // Validate existing path
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ error: `Path does not exist: ${absPath}` })
    }
  }

  const wiki: WikiConfig = {
    id: randomUUID().split('-')[0],
    name: name.trim(),
    path: absPath,
    color: color ?? '#89b4fa',
    createdAt: new Date().toISOString().split('T')[0],
  }

  const wikis = loadWikis()
  wikis.push(wiki)
  saveWikis(wikis)

  res.json({ ...wiki, stats: wikiStats(wiki) })
})

app.delete('/api/wikis/:id', (req, res) => {
  const wikis = loadWikis().filter((v) => v.id !== req.params.id)
  saveWikis(wikis)
  res.json({ ok: true })
})

// ─── Wiki-Scoped Middleware ───────────────────────────────────────────────────

app.use('/api/wikis/:id/*', (req, res, next) => {
  const wiki = getWiki(req.params.id)
  if (!wiki) return res.status(404).json({ error: 'Wiki not found' })
  res.locals.wiki = wiki as WikiConfig
  next()
})

// ─── Wiki Pages ───────────────────────────────────────────────────────────────

app.get('/api/wikis/:id/wiki', (_req, res) => {
  const v = res.locals.wiki as WikiConfig
  const scanDir = isWikiMode(v) ? wikiDir(v) : v.path
  const files = getAllMdFiles(scanDir)
  const pages = files.map((f) => {
    const raw = safeRead(f) ?? ''
    const { data, content } = matter(raw)
    const id = pageIdFromPath(f, v)
    const links = extractLinks(content)
    return {
      id,
      title: (data.title as string) || id.split('/').pop() || id,
      type: (data.type as string) || 'page',
      tags: (data.tags as string[]) || [],
      sources: (data.sources as number) || 0,
      created: (data.created as string) || '',
      updated: (data.updated as string) || '',
      links,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      excerpt: content.replace(/^#+.*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 160),
    }
  })
  res.json(pages)
})

app.get('/api/wikis/:id/wiki/*', (req, res) => {
  const v = res.locals.wiki as WikiConfig
  const pageId = (req.params as Record<string, string>)['0']
  const baseDir = isWikiMode(v) ? wikiDir(v) : v.path
  const filePath = path.join(baseDir, pageId + '.md')
  const raw = safeRead(filePath)
  if (!raw) return res.status(404).json({ error: 'Page not found' })

  const { data, content } = matter(raw)
  const links = extractLinks(content)

  // Compute backlinks (wiki-mode only; plain folders don't use [[WikiLink]] syntax)
  const backlinks: string[] = []
  if (isWikiMode(v)) {
    for (const f of getAllMdFiles(baseDir)) {
      const fLinks = extractLinks(safeRead(f) ?? '')
      const targetName = pageId.split('/').pop() || pageId
      if (fLinks.some((l) => l === targetName || l === pageId)) {
        backlinks.push(pageIdFromPath(f, v))
      }
    }
  }

  res.json({ id: pageId, frontmatter: data, content, links, backlinks })
})

// ─── Graph ────────────────────────────────────────────────────────────────────

app.get('/api/wikis/:id/graph', (_req, res) => {
  const v = res.locals.wiki as WikiConfig
  const files = getAllMdFiles(wikiDir(v))

  type N = { id: string; title: string; type: string; tags: string[]; linkCount: number; wordCount: number }
  const nodeMap = new Map<string, N>()
  const rawLinks: Array<{ source: string; target: string }> = []

  for (const f of files) {
    const { data, content } = matter(safeRead(f) ?? '')
    const id = pageIdFromPath(f, v)
    const links = extractLinks(content)
    nodeMap.set(id, {
      id,
      title: (data.title as string) || id.split('/').pop() || id,
      type: (data.type as string) || 'page',
      tags: (data.tags as string[]) || [],
      linkCount: links.length,
      wordCount: content.split(/\s+/).filter(Boolean).length,
    })
    for (const link of links) rawLinks.push({ source: id, target: link })
  }

  const resolved = rawLinks.flatMap(({ source, target }) => {
    if (nodeMap.has(target)) return [{ source, target }]
    for (const [nodeId] of nodeMap) {
      if (nodeId.split('/').pop() === target) return [{ source, target: nodeId }]
    }
    return []
  })

  for (const { target } of resolved) {
    const n = nodeMap.get(target)
    if (n) n.linkCount++
  }

  res.json({ nodes: [...nodeMap.values()], links: resolved })
})

// ─── Search ───────────────────────────────────────────────────────────────────

app.get('/api/wikis/:id/search', (req, res) => {
  const v = res.locals.wiki as WikiConfig
  const q = ((req.query.q as string) || '').toLowerCase().trim()
  if (!q) return res.json([])

  const scanDir = isWikiMode(v) ? wikiDir(v) : v.path
  const results = getAllMdFiles(scanDir).flatMap((f) => {
    const raw = safeRead(f) ?? ''
    const { data, content } = matter(raw)
    const id = pageIdFromPath(f, v)
    const title = ((data.title as string) || id).toLowerCase()
    const body = content.toLowerCase()
    let score = 0
    if (title.includes(q)) score += 10
    if (title === q) score += 20
    score += (body.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    if (!score) return []
    const idx = body.indexOf(q)
    const start = Math.max(0, idx - 60)
    return [{ id, title: (data.title as string) || id, type: (data.type as string) || 'page',
      excerpt: `...${content.slice(start, start + 200).replace(/\s+/g, ' ').trim()}...`, score }]
  }).sort((a, b) => b.score - a.score).slice(0, 20)

  res.json(results)
})

// ─── Raw Sources ──────────────────────────────────────────────────────────────

const NO_INBOX_ERROR = 'No raw/inbox/ folder found. Run /create-wiki in your IDE to set up the wiki structure.'

app.get('/api/wikis/:id/raw', (_req, res) => {
  const v = res.locals.wiki as WikiConfig
  const inbox = inboxDir(v)
  const raw = rawDir(v)
  const inboxExists = !!inbox && fs.existsSync(inbox)
  const files = getAllRawFiles(v).map((f) => {
    const stat = fs.statSync(f)
    return {
      path: path.relative(raw ?? v.path, f).replace(/\\/g, '/'),
      name: path.basename(f),
      size: stat.size,
      modified: stat.mtime.toISOString(),
    }
  })
  res.json({ files, inboxExists })
})

const storageFor = (inbox: string) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, inbox),
  filename: (_req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
})

app.post('/api/wikis/:id/raw/upload', (req, res) => {
  const v = res.locals.wiki as WikiConfig
  const inbox = inboxDir(v)
  if (!inbox || !fs.existsSync(inbox)) {
    return res.status(400).json({ error: NO_INBOX_ERROR })
  }
  const raw = rawDir(v)!
  multer({ storage: storageFor(inbox) }).array('files')(req, res, (err) => {
    if (err) return res.status(500).json({ error: String(err) })
    const files = (req.files as Express.Multer.File[]) || []
    res.json({ uploaded: files.map((f) => ({ name: f.originalname, path: path.relative(raw, f.path).replace(/\\/g, '/'), size: f.size })) })
  })
})

app.post('/api/wikis/:id/raw/text', (req, res) => {
  try {
    const v = res.locals.wiki as WikiConfig
    const inbox = inboxDir(v)
    if (!inbox || !fs.existsSync(inbox)) {
      return res.status(400).json({ error: NO_INBOX_ERROR })
    }
    const { filename, content } = req.body as { filename?: string; content?: string }
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' })
    const rawName = (filename?.trim() || `note-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const finalName = rawName.endsWith('.md') ? rawName : `${rawName}.md`
    const filePath = path.join(inbox, finalName)
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`[text] saved ${finalName} → ${filePath}`)
    res.json({ name: finalName, path: finalName, size: Buffer.byteLength(content) })
  } catch (err) {
    console.error('[text] error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// ─── Log ──────────────────────────────────────────────────────────────────────

app.get('/api/wikis/:id/log', (_req, res) => {
  const v = res.locals.wiki as WikiConfig
  const raw = safeRead(path.join(wikiDir(v), 'log.md')) ?? ''
  const { content } = matter(raw)
  const entries = content.split(/(?=^## \[)/m)
    .map((p) => p.trim()).filter(Boolean)
    .map((p) => { const lines = p.split('\n'); return { header: lines[0].replace(/^## /, ''), body: lines.slice(1).join('\n').trim() } })
  res.json(entries)
})

// ─── HTTP + WebSocket ─────────────────────────────────────────────────────────

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

function broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data })
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg)
}

// Watch all wiki paths
function watchVaults() {
  const wikis = loadWikis()
  const paths = wikis.flatMap((v) => [path.join(v.path, 'wiki'), path.join(v.path, 'raw')])
    .filter((p) => fs.existsSync(p))

  if (!paths.length) return

  // Normalise to forward slashes so matching works on Windows (chokidar
  // emits forward-slash paths even on Windows, but stored paths may not).
  const normFwd = (p: string) => p.replace(/\\/g, '/')
  const findWiki = (f: string) =>
    wikis.find((v) => normFwd(f).startsWith(normFwd(v.path)))

  chokidar.watch(paths, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } })
    .on('add',    (f) => broadcast('file:add',    { path: f, wikiId: findWiki(f)?.id }))
    .on('change', (f) => broadcast('file:change', { path: f, wikiId: findWiki(f)?.id }))
    .on('unlink', (f) => broadcast('file:remove', { path: f, wikiId: findWiki(f)?.id }))
}

watchVaults()

// ─── Serve Frontend ───────────────────────────────────────────────────────────

const DIST_DIR = path.resolve(__dirname, '../dist')
const isProd = process.env.NODE_ENV === 'production'

if (isProd && fs.existsSync(DIST_DIR)) {
  // Production: serve the built React app
  app.use(express.static(DIST_DIR))
  // SPA fallback — let React Router handle all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  // Dev mode: Vite handles the frontend on :5173
  app.get('*', (_req, res) => {
    res.redirect('http://localhost:5173')
  })
}

const PORT = 3001
httpServer.listen(PORT, () => {
  const hasBuilt = fs.existsSync(DIST_DIR)
  console.log(`\n  Wiki server →  http://localhost:${PORT}`)
  if (!hasBuilt) {
    console.log(`  UI dev server → http://localhost:5173  (open this one)`)
  }
  console.log()
})
