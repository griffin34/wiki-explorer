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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const VAULTS_FILE = path.join(DATA_DIR, 'vaults.json')

// ─── Vault Config ─────────────────────────────────────────────────────────────

interface VaultConfig {
  id: string
  name: string
  path: string
  color: string
  createdAt: string
}

function loadVaults(): VaultConfig[] {
  try {
    const raw = fs.readFileSync(VAULTS_FILE, 'utf-8')
    return (JSON.parse(raw) as { vaults: VaultConfig[] }).vaults ?? []
  } catch {
    return []
  }
}

function saveVaults(vaults: VaultConfig[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(VAULTS_FILE, JSON.stringify({ vaults }, null, 2))
}

function getVault(id: string): VaultConfig | undefined {
  return loadVaults().find((v) => v.id === id)
}

// ─── Vault Path Helpers ───────────────────────────────────────────────────────

const wikiDir = (v: VaultConfig) => path.join(v.path, 'wiki')
const inboxDir = (v: VaultConfig) => path.join(v.path, 'raw', 'inbox')
const rawDir = (v: VaultConfig) => path.join(v.path, 'raw')

// ─── File Utilities ───────────────────────────────────────────────────────────

function safeRead(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8') } catch { return null }
}

function getAllMdFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) results.push(full)
    }
  }
  walk(dir)
  return results
}

function getAllRawFiles(v: VaultConfig): string[] {
  const results: string[] = []
  // Check inbox first, then raw root for legacy
  for (const dir of [inboxDir(v), rawDir(v)]) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
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

function pageIdFromPath(filePath: string, v: VaultConfig): string {
  return path.relative(wikiDir(v), filePath).replace(/\.md$/, '')
}

// ─── Vault Stats ──────────────────────────────────────────────────────────────

function vaultStats(v: VaultConfig) {
  const pages = getAllMdFiles(wikiDir(v))
  const sources = getAllRawFiles(v)
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

// ─── Vault Management API ─────────────────────────────────────────────────────

app.get('/api/vaults', (_req, res) => {
  const vaults = loadVaults()
  const result = vaults.map((v) => ({ ...v, stats: vaultStats(v) }))
  res.json(result)
})

app.post('/api/vaults', (req, res) => {
  const { name, vaultPath, color, create } = req.body as {
    name?: string
    vaultPath?: string
    color?: string
    create?: boolean
  }
  if (!name?.trim() || !vaultPath?.trim()) {
    return res.status(400).json({ error: 'name and vaultPath are required' })
  }

  const absPath = path.resolve(vaultPath.trim())

  if (create) {
    // Create the vault directory structure
    fs.mkdirSync(path.join(absPath, 'wiki'), { recursive: true })
    fs.mkdirSync(path.join(absPath, 'raw', 'inbox'), { recursive: true })
    fs.mkdirSync(path.join(absPath, 'raw', 'assets'), { recursive: true })

    // Create stub LLM files
    const stubs: Record<string, string> = {
      'AGENTS.md': 'OpenAI Codex / OpenAI Agents',
      'CLAUDE.md': 'Claude Code / Anthropic',
      'GEMINI.md': 'Gemini CLI / Google',
    }
    for (const [file, agent] of Object.entries(stubs)) {
      fs.writeFileSync(
        path.join(absPath, file),
        `# Wiki — Agent Instructions (${agent})\n\nThis is a personal wiki vault. The wiki/ directory contains markdown pages with YAML frontmatter. Use [[Page Name]] syntax for wiki links.\n`
      )
    }

    // Seed wiki/index.md and wiki/log.md
    const today = new Date().toISOString().split('T')[0]
    fs.writeFileSync(path.join(absPath, 'wiki', 'index.md'),
      `---\ntitle: "Wiki Index"\ntype: overview\nupdated: ${today}\n---\n\n# Wiki Index\n\n_0 pages · 0 sources ingested_\n`)
    fs.writeFileSync(path.join(absPath, 'wiki', 'log.md'),
      `---\ntitle: "Activity Log"\ntype: overview\nupdated: ${today}\n---\n\n# Activity Log\n\n## [${today}] init | Vault created\n\n- Vault "${name}" initialized.\n`)
  } else {
    // Validate existing path
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({ error: `Path does not exist: ${absPath}` })
    }
  }

  const vault: VaultConfig = {
    id: randomUUID().split('-')[0],
    name: name.trim(),
    path: absPath,
    color: color ?? '#89b4fa',
    createdAt: new Date().toISOString().split('T')[0],
  }

  const vaults = loadVaults()
  vaults.push(vault)
  saveVaults(vaults)

  res.json({ ...vault, stats: vaultStats(vault) })
})

app.delete('/api/vaults/:id', (req, res) => {
  const vaults = loadVaults().filter((v) => v.id !== req.params.id)
  saveVaults(vaults)
  res.json({ ok: true })
})

// ─── Vault-Scoped Middleware ───────────────────────────────────────────────────

app.use('/api/vaults/:id/*', (req, res, next) => {
  const vault = getVault(req.params.id)
  if (!vault) return res.status(404).json({ error: 'Vault not found' })
  res.locals.vault = vault as VaultConfig
  next()
})

// ─── Wiki Pages ───────────────────────────────────────────────────────────────

app.get('/api/vaults/:id/wiki', (_req, res) => {
  const v = res.locals.vault as VaultConfig
  const files = getAllMdFiles(wikiDir(v))
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

app.get('/api/vaults/:id/wiki/*', (req, res) => {
  const v = res.locals.vault as VaultConfig
  const pageId = (req.params as Record<string, string>)['0']
  const filePath = path.join(wikiDir(v), pageId + '.md')
  const raw = safeRead(filePath)
  if (!raw) return res.status(404).json({ error: 'Page not found' })

  const { data, content } = matter(raw)
  const links = extractLinks(content)

  // Compute backlinks
  const backlinks: string[] = []
  for (const f of getAllMdFiles(wikiDir(v))) {
    const fLinks = extractLinks(safeRead(f) ?? '')
    const targetName = pageId.split('/').pop() || pageId
    if (fLinks.some((l) => l === targetName || l === pageId)) {
      backlinks.push(pageIdFromPath(f, v))
    }
  }

  res.json({ id: pageId, frontmatter: data, content, links, backlinks })
})

// ─── Graph ────────────────────────────────────────────────────────────────────

app.get('/api/vaults/:id/graph', (_req, res) => {
  const v = res.locals.vault as VaultConfig
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

app.get('/api/vaults/:id/search', (req, res) => {
  const v = res.locals.vault as VaultConfig
  const q = ((req.query.q as string) || '').toLowerCase().trim()
  if (!q) return res.json([])

  const results = getAllMdFiles(wikiDir(v)).flatMap((f) => {
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

app.get('/api/vaults/:id/raw', (_req, res) => {
  const v = res.locals.vault as VaultConfig
  res.json(getAllRawFiles(v).map((f) => {
    const stat = fs.statSync(f)
    return { path: path.relative(rawDir(v), f), name: path.basename(f), size: stat.size, modified: stat.mtime.toISOString() }
  }))
})

const storageFor = (v: VaultConfig) => multer.diskStorage({
  destination: (_req, _file, cb) => { fs.mkdirSync(inboxDir(v), { recursive: true }); cb(null, inboxDir(v)) },
  filename: (_req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
})

app.post('/api/vaults/:id/raw/upload', (req, res) => {
  const v = res.locals.vault as VaultConfig
  multer({ storage: storageFor(v) }).array('files')(req, res, (err) => {
    if (err) return res.status(500).json({ error: String(err) })
    const files = (req.files as Express.Multer.File[]) || []
    res.json({ uploaded: files.map((f) => ({ name: f.originalname, path: path.relative(rawDir(v), f.path), size: f.size })) })
  })
})

app.post('/api/vaults/:id/raw/text', (req, res) => {
  try {
    const v = res.locals.vault as VaultConfig
    const { filename, content } = req.body as { filename?: string; content?: string }
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' })
    const rawName = (filename?.trim() || `note-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const finalName = rawName.endsWith('.md') ? rawName : `${rawName}.md`
    const filePath = path.join(inboxDir(v), finalName)
    fs.mkdirSync(inboxDir(v), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`[text] saved ${finalName} → ${filePath}`)
    res.json({ name: finalName, path: finalName, size: Buffer.byteLength(content) })
  } catch (err) {
    console.error('[text] error:', err)
    res.status(500).json({ error: String(err) })
  }
})

// ─── Log ──────────────────────────────────────────────────────────────────────

app.get('/api/vaults/:id/log', (_req, res) => {
  const v = res.locals.vault as VaultConfig
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

// Watch all vault paths
function watchVaults() {
  const vaults = loadVaults()
  const paths = vaults.flatMap((v) => [path.join(v.path, 'wiki'), path.join(v.path, 'raw')])
    .filter((p) => fs.existsSync(p))

  if (!paths.length) return

  chokidar.watch(paths, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } })
    .on('add', (f) => {
      const vault = vaults.find((v) => f.startsWith(v.path))
      broadcast('file:add', { path: f, vaultId: vault?.id })
    })
    .on('change', (f) => {
      const vault = vaults.find((v) => f.startsWith(v.path))
      broadcast('file:change', { path: f, vaultId: vault?.id })
    })
    .on('unlink', (f) => {
      const vault = vaults.find((v) => f.startsWith(v.path))
      broadcast('file:remove', { path: f, vaultId: vault?.id })
    })
}

watchVaults()

// ─── Serve Frontend ───────────────────────────────────────────────────────────

const DIST_DIR = path.resolve(__dirname, '../dist')

if (fs.existsSync(DIST_DIR)) {
  // Production: serve the built React app
  app.use(express.static(DIST_DIR))
  // SPA fallback — let React Router handle all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  // Dev mode: the Vite server handles the frontend on :5173
  // Give a helpful redirect instead of "Cannot GET /"
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
