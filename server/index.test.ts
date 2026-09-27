import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ── Test environment setup ────────────────────────────────────────────────────
// We set WIKI_DATA_DIR before importing the server so it writes vaults.json to
// a temp directory rather than the real data/ folder.

let tmpDir: string
let dataDir: string

// Set env vars synchronously before any dynamic import
tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'))
dataDir = path.join(tmpDir, 'data')
fs.mkdirSync(dataDir, { recursive: true })
process.env.WIKI_DATA_DIR = dataDir
process.env.NODE_ENV = 'test'

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { app } = await import('./index.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a wiki-mode structure one level BELOW base (LLM-created subfolder case). */
function makeNestedWikiFolder(base: string, subName: string) {
  const sub = path.join(base, subName)
  makeWikiFolder(sub)
}

function makeWikiFolder(base: string) {
  const wikiDir = path.join(base, 'wiki')
  const rawDir = path.join(base, 'raw', 'inbox')
  fs.mkdirSync(wikiDir, { recursive: true })
  fs.mkdirSync(rawDir, { recursive: true })
  fs.writeFileSync(path.join(wikiDir, 'index.md'), [
    '---',
    'title: Home',
    'type: overview',
    '---',
    '# Home',
    'Welcome to the wiki. [[about]]',
  ].join('\n'))
  fs.writeFileSync(path.join(wikiDir, 'about.md'), [
    '---',
    'title: About',
    'type: page',
    '---',
    '# About',
    'Some info.',
  ].join('\n'))
}

function makePlainFolder(base: string) {
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(path.join(base, 'readme.md'), '# Readme\nThis is plain.')
  fs.writeFileSync(path.join(base, 'notes.md'), '# Notes\nSome notes here.')
  const sub = path.join(base, 'subfolder')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, 'deep.md'), '# Deep\nNested file.')
}

async function addWiki(name: string, wikiPath: string): Promise<string> {
  const res = await request(app)
    .post('/api/wikis')
    .send({ name, wikiPath, color: '#aabbcc', create: false })
  expect(res.status).toBe(200)
  return (res.body as { id: string }).id
}

async function cleanup(id: string) {
  await request(app).delete(`/api/wikis/${id}`)
}

// ── Cleanup temp dir after all tests ─────────────────────────────────────────
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── GET /api/wikis — mode field ───────────────────────────────────────────────

describe('GET /api/wikis — mode detection', () => {
  let wikiId: string
  let folderId: string
  const wikiPath = path.join(tmpDir, 'wiki-mode-test')
  const folderPath = path.join(tmpDir, 'folder-mode-test')

  beforeAll(async () => {
    makeWikiFolder(wikiPath)
    makePlainFolder(folderPath)
    wikiId = await addWiki('Wiki Test', wikiPath)
    folderId = await addWiki('Folder Test', folderPath)
  })

  afterAll(async () => {
    await cleanup(wikiId)
    await cleanup(folderId)
  })

  it('returns mode=wiki for a structured wiki folder', async () => {
    const res = await request(app).get('/api/wikis')
    const wikis = res.body as Array<{ id: string; mode: string }>
    const entry = wikis.find((w) => w.id === wikiId)
    expect(entry?.mode).toBe('wiki')
  })

  it('returns mode=folder for a plain markdown folder', async () => {
    const res = await request(app).get('/api/wikis')
    const wikis = res.body as Array<{ id: string; mode: string }>
    const entry = wikis.find((w) => w.id === folderId)
    expect(entry?.mode).toBe('folder')
  })

  it('includes stats.pageCount > 0 for both modes', async () => {
    const res = await request(app).get('/api/wikis')
    const wikis = res.body as Array<{ id: string; stats: { pageCount: number } }>
    const wikiEntry = wikis.find((w) => w.id === wikiId)
    const folderEntry = wikis.find((w) => w.id === folderId)
    expect(wikiEntry?.stats.pageCount).toBeGreaterThan(0)
    expect(folderEntry?.stats.pageCount).toBeGreaterThan(0)
  })
})

// ── Page list — wiki mode ─────────────────────────────────────────────────────

describe('GET /api/wikis/:id/wiki — wiki mode', () => {
  let id: string
  const base = path.join(tmpDir, 'wiki-pages-test')

  beforeAll(async () => {
    makeWikiFolder(base)
    id = await addWiki('Wiki Pages', base)
  })
  afterAll(() => cleanup(id))

  it('returns pages from the wiki/ subdirectory', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki`)
    expect(res.status).toBe(200)
    const pages = res.body as Array<{ id: string }>
    expect(pages.map((p) => p.id)).toContain('index')
    expect(pages.map((p) => p.id)).toContain('about')
  })

  it('page IDs do not include the wiki/ prefix', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki`)
    const pages = res.body as Array<{ id: string }>
    expect(pages.every((p) => !p.id.startsWith('wiki/'))).toBe(true)
  })

  it('extracts title from frontmatter', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki`)
    const pages = res.body as Array<{ id: string; title: string }>
    const home = pages.find((p) => p.id === 'index')
    expect(home?.title).toBe('Home')
  })
})

// ── Page list — folder mode ───────────────────────────────────────────────────

describe('GET /api/wikis/:id/wiki — folder mode', () => {
  let id: string
  const base = path.join(tmpDir, 'folder-pages-test')

  beforeAll(async () => {
    makePlainFolder(base)
    id = await addWiki('Folder Pages', base)
  })
  afterAll(() => cleanup(id))

  it('returns all .md files from the folder root', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki`)
    expect(res.status).toBe(200)
    const pages = res.body as Array<{ id: string }>
    const ids = pages.map((p) => p.id)
    expect(ids).toContain('readme')
    expect(ids).toContain('notes')
    expect(ids).toContain('subfolder/deep')
  })

  it('page IDs are relative to the folder root, not a wiki/ subdir', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki`)
    const pages = res.body as Array<{ id: string }>
    expect(pages.every((p) => !p.id.startsWith('wiki/'))).toBe(true)
  })
})

// ── Single page — wiki mode ───────────────────────────────────────────────────

describe('GET /api/wikis/:id/wiki/:pageId — wiki mode', () => {
  let id: string
  const base = path.join(tmpDir, 'wiki-single-test')

  beforeAll(async () => {
    makeWikiFolder(base)
    id = await addWiki('Wiki Single', base)
  })
  afterAll(() => cleanup(id))

  it('returns page content and frontmatter', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/index`)
    expect(res.status).toBe(200)
    expect(res.body.frontmatter.title).toBe('Home')
    expect(res.body.content).toContain('Welcome')
  })

  it('returns backlinks for pages that are referenced', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/about`)
    expect(res.status).toBe(200)
    // index links to [[about]], so about should have index as a backlink
    expect(res.body.backlinks).toContain('index')
  })

  it('returns 404 for a page that does not exist', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/nonexistent`)
    expect(res.status).toBe(404)
  })
})

// ── Single page — folder mode ─────────────────────────────────────────────────

describe('GET /api/wikis/:id/wiki/:pageId — folder mode', () => {
  let id: string
  const base = path.join(tmpDir, 'folder-single-test')

  beforeAll(async () => {
    makePlainFolder(base)
    id = await addWiki('Folder Single', base)
  })
  afterAll(() => cleanup(id))

  it('returns content for a top-level file', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/readme`)
    expect(res.status).toBe(200)
    expect(res.body.content).toContain('plain')
  })

  it('returns content for a nested file', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/subfolder/deep`)
    expect(res.status).toBe(200)
    expect(res.body.content).toContain('Nested')
  })

  it('returns empty backlinks (plain folders skip backlink scanning)', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/readme`)
    expect(res.status).toBe(200)
    expect(res.body.backlinks).toEqual([])
  })

  it('returns 404 for a missing file', async () => {
    const res = await request(app).get(`/api/wikis/${id}/wiki/nope`)
    expect(res.status).toBe(404)
  })
})

// ── Search ────────────────────────────────────────────────────────────────────

describe('GET /api/wikis/:id/search', () => {
  let wikiId: string
  let folderId: string
  const wikiBase = path.join(tmpDir, 'wiki-search-test')
  const folderBase = path.join(tmpDir, 'folder-search-test')

  beforeAll(async () => {
    makeWikiFolder(wikiBase)
    makePlainFolder(folderBase)
    wikiId = await addWiki('Wiki Search', wikiBase)
    folderId = await addWiki('Folder Search', folderBase)
  })
  afterAll(async () => { await cleanup(wikiId); await cleanup(folderId) })

  it('finds pages by body text in wiki mode', async () => {
    const res = await request(app).get(`/api/wikis/${wikiId}/search?q=Welcome`)
    expect(res.status).toBe(200)
    const results = res.body as Array<{ id: string }>
    expect(results.some((r) => r.id === 'index')).toBe(true)
  })

  it('finds pages by body text in folder mode', async () => {
    const res = await request(app).get(`/api/wikis/${folderId}/search?q=plain`)
    expect(res.status).toBe(200)
    const results = res.body as Array<{ id: string }>
    expect(results.some((r) => r.id === 'readme')).toBe(true)
  })

  it('returns empty array for no matches', async () => {
    const res = await request(app).get(`/api/wikis/${wikiId}/search?q=xyzzy_no_match`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns empty array for blank query', async () => {
    const res = await request(app).get(`/api/wikis/${wikiId}/search?q=`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('sorts multiple results by score (highest first)', async () => {
    // "about" matches about.md title exactly (score 30+) and index.md body ([[about]], score 1)
    const res = await request(app).get(`/api/wikis/${wikiId}/search?q=about`)
    expect(res.status).toBe(200)
    const results = res.body as Array<{ id: string; score: number }>
    expect(results.length).toBeGreaterThan(1)
    // First result should have higher score than subsequent ones
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })
})

// ── Wiki management ───────────────────────────────────────────────────────────

describe('POST /api/wikis + DELETE /api/wikis/:id', () => {
  it('rejects missing name', async () => {
    const res = await request(app).post('/api/wikis').send({ wikiPath: tmpDir, color: '#fff', create: false })
    expect(res.status).toBe(400)
  })

  it('rejects a path that does not exist', async () => {
    const res = await request(app).post('/api/wikis').send({
      name: 'Ghost',
      wikiPath: path.join(tmpDir, 'does-not-exist'),
      color: '#fff',
      create: false,
    })
    expect(res.status).toBe(400)
  })

  it('adds and removes a wiki', async () => {
    const dir = path.join(tmpDir, 'add-remove-test')
    makePlainFolder(dir)
    const addRes = await request(app).post('/api/wikis').send({ name: 'Temp', wikiPath: dir, color: '#fff', create: false })
    expect(addRes.status).toBe(200)
    const id = (addRes.body as { id: string }).id

    const listBefore = await request(app).get('/api/wikis')
    expect((listBefore.body as Array<{ id: string }>).some((w) => w.id === id)).toBe(true)

    await request(app).delete(`/api/wikis/${id}`)
    const listAfter = await request(app).get('/api/wikis')
    expect((listAfter.body as Array<{ id: string }>).some((w) => w.id === id)).toBe(false)
  })

  it('creates a new wiki folder with create:true', async () => {
    const parent = path.join(tmpDir, 'create-parent')
    fs.mkdirSync(parent, { recursive: true })
    const res = await request(app).post('/api/wikis').send({
      name: 'Brand New',
      wikiPath: parent,
      color: '#cba6f7',
      create: true,
    })
    expect(res.status).toBe(200)
    const created = res.body as { id: string; path: string }
    expect(fs.existsSync(created.path)).toBe(true)
    await request(app).delete(`/api/wikis/${created.id}`)
  })
})

// ── Wiki-scoped middleware 404 ─────────────────────────────────────────────────

describe('Wiki-scoped middleware', () => {
  it('returns 404 for an unknown wiki id', async () => {
    const res = await request(app).get('/api/wikis/nonexistent-id/wiki')
    expect(res.status).toBe(404)
  })
})

// ── IDE endpoint validation ───────────────────────────────────────────────────

describe('POST /api/open-in-ide — validation', () => {
  it('returns 400 when ide or path is missing', async () => {
    const res = await request(app).post('/api/open-in-ide').send({ ide: 'cursor' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for an unknown IDE id', async () => {
    const res = await request(app).post('/api/open-in-ide').send({ ide: 'notepad', path: '/tmp' })
    expect(res.status).toBe(400)
  })
})

// ── Graph API ─────────────────────────────────────────────────────────────────

describe('GET /api/wikis/:id/graph — wiki mode', () => {
  let id: string
  const base = path.join(tmpDir, 'graph-test')

  beforeAll(async () => {
    makeWikiFolder(base)
    // Add a nested file and a page linking to it by basename (fuzzy resolution path)
    // and a link to a nonexistent page (unresolvable path)
    const wikiDir = path.join(base, 'wiki')
    const conceptsDir = path.join(wikiDir, 'concepts')
    fs.mkdirSync(conceptsDir, { recursive: true })
    fs.writeFileSync(path.join(conceptsDir, 'deep.md'), [
      '---', 'title: Deep', 'type: concept', '---', 'Deep concept.',
    ].join('\n'))
    // Rewrite index to link to "deep" (basename only) and "ghost" (nonexistent)
    fs.writeFileSync(path.join(wikiDir, 'index.md'), [
      '---', 'title: Home', 'type: overview', '---',
      '# Home', 'Welcome. [[about]] [[deep]] [[ghost]]',
    ].join('\n'))
    id = await addWiki('Graph Test', base)
  })
  afterAll(() => cleanup(id))

  it('returns nodes and links', async () => {
    const res = await request(app).get(`/api/wikis/${id}/graph`)
    expect(res.status).toBe(200)
    const { nodes, links } = res.body as { nodes: Array<{ id: string }>; links: unknown[] }
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.some((n) => n.id === 'index')).toBe(true)
    // index links to [[about]], so there should be at least one link
    expect(links.length).toBeGreaterThan(0)
  })

  it('resolves links using basename fuzzy matching (nested page)', async () => {
    const res = await request(app).get(`/api/wikis/${id}/graph`)
    expect(res.status).toBe(200)
    const { nodes, links } = res.body as {
      nodes: Array<{ id: string; linkCount: number }>
      links: Array<{ source: string; target: string }>
    }
    // concepts/deep should exist as a node and have at least 1 link (from index)
    expect(nodes.some((n) => n.id === 'concepts/deep')).toBe(true)
    expect(links.some((l) => l.source === 'index' && l.target === 'concepts/deep')).toBe(true)
    // ghost link is unresolvable — should NOT appear as a node or link
    expect(nodes.some((n) => n.id === 'ghost')).toBe(false)
  })

  it('returns node metadata (type, title, linkCount, wordCount)', async () => {
    const res = await request(app).get(`/api/wikis/${id}/graph`)
    const { nodes } = res.body as { nodes: Array<{ id: string; title: string; type: string; linkCount: number; wordCount: number }> }
    const home = nodes.find((n) => n.id === 'index')
    expect(home?.title).toBe('Home')
    expect(home?.type).toBe('overview')
    expect(typeof home?.wordCount).toBe('number')
  })
})

// ── Raw files ─────────────────────────────────────────────────────────────────

describe('GET /api/wikis/:id/raw', () => {
  let wikiId: string
  let folderIdNoInbox: string
  const wikiBase = path.join(tmpDir, 'raw-test')
  const folderBase = path.join(tmpDir, 'raw-folder-test')

  beforeAll(async () => {
    makeWikiFolder(wikiBase)
    // Add a raw file to the inbox
    const inboxFile = path.join(wikiBase, 'raw', 'inbox', 'source.txt')
    fs.writeFileSync(inboxFile, 'raw source content')
    wikiId = await addWiki('Raw Test', wikiBase)

    makePlainFolder(folderBase)
    folderIdNoInbox = await addWiki('Plain Raw', folderBase)
  })
  afterAll(async () => { await cleanup(wikiId); await cleanup(folderIdNoInbox) })

  it('returns file list and inboxExists=true for a structured wiki', async () => {
    const res = await request(app).get(`/api/wikis/${wikiId}/raw`)
    expect(res.status).toBe(200)
    const { files, inboxExists } = res.body as { files: Array<{ name: string }>; inboxExists: boolean }
    expect(inboxExists).toBe(true)
    expect(files.some((f) => f.name === 'source.txt')).toBe(true)
  })

  it('returns inboxExists=false for a plain folder', async () => {
    const res = await request(app).get(`/api/wikis/${folderIdNoInbox}/raw`)
    expect(res.status).toBe(200)
    expect((res.body as { inboxExists: boolean }).inboxExists).toBe(false)
  })
})

// ── Raw upload ────────────────────────────────────────────────────────────────

describe('POST /api/wikis/:id/raw/upload', () => {
  let wikiId: string
  let folderId: string
  const wikiBase = path.join(tmpDir, 'upload-test')
  const folderBase = path.join(tmpDir, 'upload-folder-test')

  beforeAll(async () => {
    makeWikiFolder(wikiBase)
    wikiId = await addWiki('Upload Test', wikiBase)
    makePlainFolder(folderBase)
    folderId = await addWiki('Upload Folder', folderBase)
  })
  afterAll(async () => { await cleanup(wikiId); await cleanup(folderId) })

  it('uploads a file to the inbox', async () => {
    const res = await request(app)
      .post(`/api/wikis/${wikiId}/raw/upload`)
      .attach('files', Buffer.from('upload content'), 'uploaded.txt')
    expect(res.status).toBe(200)
    const { uploaded } = res.body as { uploaded: Array<{ name: string }> }
    expect(uploaded.some((f) => f.name === 'uploaded.txt')).toBe(true)
  })

  it('returns 400 when no inbox folder exists (plain folder)', async () => {
    const res = await request(app)
      .post(`/api/wikis/${folderId}/raw/upload`)
      .attach('files', Buffer.from('data'), 'test.txt')
    expect(res.status).toBe(400)
  })
})

// ── Paste text ────────────────────────────────────────────────────────────────

describe('POST /api/wikis/:id/raw/text', () => {
  let wikiId: string
  let folderId: string
  const wikiBase = path.join(tmpDir, 'paste-test')
  const folderBase = path.join(tmpDir, 'paste-folder-test')

  beforeAll(async () => {
    makeWikiFolder(wikiBase)
    wikiId = await addWiki('Paste Test', wikiBase)
    makePlainFolder(folderBase)
    folderId = await addWiki('Paste Folder', folderBase)
  })
  afterAll(async () => { await cleanup(wikiId); await cleanup(folderId) })

  it('saves pasted text to inbox with auto-generated filename', async () => {
    const res = await request(app)
      .post(`/api/wikis/${wikiId}/raw/text`)
      .send({ filename: '', content: 'Meeting notes from today.' })
    expect(res.status).toBe(200)
    const { name } = res.body as { name: string }
    expect(name).toMatch(/\.md$/)
    expect(fs.existsSync(path.join(wikiBase, 'raw', 'inbox', name))).toBe(true)
  })

  it('saves pasted text with a user-supplied filename', async () => {
    const res = await request(app)
      .post(`/api/wikis/${wikiId}/raw/text`)
      .send({ filename: 'my-notes', content: '# Notes\nContent here.' })
    expect(res.status).toBe(200)
    expect((res.body as { name: string }).name).toBe('my-notes.md')
  })

  it('returns 400 for empty content', async () => {
    const res = await request(app)
      .post(`/api/wikis/${wikiId}/raw/text`)
      .send({ filename: 'empty', content: '' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when no inbox exists (plain folder)', async () => {
    const res = await request(app)
      .post(`/api/wikis/${folderId}/raw/text`)
      .send({ filename: 'x', content: 'data' })
    expect(res.status).toBe(400)
  })
})

// ── Activity log ──────────────────────────────────────────────────────────────

describe('GET /api/wikis/:id/log', () => {
  let wikiId: string
  let emptyWikiId: string
  const wikiBase = path.join(tmpDir, 'log-test')
  const emptyBase = path.join(tmpDir, 'log-empty-test')

  beforeAll(async () => {
    makeWikiFolder(wikiBase)
    fs.writeFileSync(
      path.join(wikiBase, 'wiki', 'log.md'),
      [
        '---',
        'title: Log',
        '---',
        '',
        '## [2026-05-01] ingest | First source',
        'Added the first raw source.',
        '',
        '## [2026-05-02] query | Research',
        '',
      ].join('\n')
    )
    wikiId = await addWiki('Log Test', wikiBase)

    makeWikiFolder(emptyBase)
    emptyWikiId = await addWiki('Empty Log', emptyBase)
  })
  afterAll(async () => { await cleanup(wikiId); await cleanup(emptyWikiId) })

  it('returns parsed log entries', async () => {
    const res = await request(app).get(`/api/wikis/${wikiId}/log`)
    expect(res.status).toBe(200)
    const entries = res.body as Array<{ header: string; body: string }>
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0].header).toContain('ingest')
  })

  it('returns empty array when no log.md exists', async () => {
    const res = await request(app).get(`/api/wikis/${emptyWikiId}/log`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

// ── Nested content root (findContentRoot returns sub) ─────────────────────────

describe('findContentRoot — nested wiki structure', () => {
  let nestedId: string
  const nestedBase = path.join(tmpDir, 'nested-parent')

  beforeAll(async () => {
    // Create a parent folder that contains a sub-folder with the wiki structure.
    // This exercises the "one level down" branch in findContentRoot.
    fs.mkdirSync(nestedBase, { recursive: true })
    makeNestedWikiFolder(nestedBase, 'my-wiki')
    nestedId = await addWiki('Nested Wiki', nestedBase)
  })
  afterAll(async () => { await cleanup(nestedId) })

  it('detects mode:wiki when content root is one level below the registered path', async () => {
    const res = await request(app).get('/api/wikis')
    expect(res.status).toBe(200)
    const wiki = (res.body as Array<{ id: string; mode: string }>).find((w) => w.id === nestedId)
    expect(wiki?.mode).toBe('wiki')
  })

  it('returns pages from the nested wiki', async () => {
    const res = await request(app).get(`/api/wikis/${nestedId}/wiki`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
