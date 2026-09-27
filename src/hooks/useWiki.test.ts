import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  useWikis,
  usePageList,
  useWikiPage,
  useGraphData,
  useSearch,
  useRawFiles,
  useLog,
  useWikiSocket,
  detectIDEs,
  openInIDE,
  pickFolder,
  addWiki,
  removeWiki,
} from './useWiki'

// ── fetch mock helpers ────────────────────────────────────────────────────────

function okFetch(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  })
}

function failFetch(status = 500, statusText = 'Error', body?: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve(body ?? { error: statusText }),
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', okFetch([]))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// ── useWikis ─────────────────────────────────────────────────────────────────

describe('useWikis', () => {
  it('fetches wikis and returns them', async () => {
    const wikis = [{ id: 'w1', name: 'Test', color: '#fff', path: '/tmp', mode: 'wiki', stats: null }]
    vi.stubGlobal('fetch', okFetch(wikis))
    const { result } = renderHook(() => useWikis())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.wikis).toEqual(wikis)
    expect(result.current.error).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    vi.stubGlobal('fetch', failFetch(500, 'Internal Server Error'))
    const { result } = renderHook(() => useWikis())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
  })

  it('reload refetches the list', async () => {
    const first = [{ id: 'w1', name: 'First', color: '#fff', path: '/tmp', mode: 'wiki', stats: null }]
    const second = [{ id: 'w2', name: 'Second', color: '#000', path: '/tmp2', mode: 'wiki', stats: null }]
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(first) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(second) })
    )
    const { result } = renderHook(() => useWikis())
    await waitFor(() => expect(result.current.wikis).toEqual(first))
    await act(() => result.current.reload())
    await waitFor(() => expect(result.current.wikis).toEqual(second))
  })
})

// ── usePageList ───────────────────────────────────────────────────────────────

describe('usePageList', () => {
  it('fetches pages for the given wikiId', async () => {
    const pages = [{ id: 'index', title: 'Home', type: 'overview', tags: [], wordCount: 10 }]
    vi.stubGlobal('fetch', okFetch(pages))
    const { result } = renderHook(() => usePageList('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.pages).toEqual(pages)
  })

  it('sets error on failure', async () => {
    vi.stubGlobal('fetch', failFetch(404, 'Not Found'))
    const { result } = renderHook(() => usePageList('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
  })
})

// ── useWikiPage ───────────────────────────────────────────────────────────────

describe('useWikiPage', () => {
  it('fetches a specific page', async () => {
    const page = {
      content: '# Hello', frontmatter: { title: 'Hello' }, backlinks: [], links: [],
    }
    vi.stubGlobal('fetch', okFetch(page))
    const { result } = renderHook(() => useWikiPage('w1', 'index'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.page).toEqual(page)
  })

  it('sets error and clears page on fetch failure', async () => {
    vi.stubGlobal('fetch', failFetch(404, 'Not Found'))
    const { result } = renderHook(() => useWikiPage('w1', 'missing'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeTruthy()
    expect(result.current.page).toBeNull()
  })

  it('clears page when pageId is null', async () => {
    const { result } = renderHook(() => useWikiPage('w1', null))
    await waitFor(() => expect(result.current.page).toBeNull())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reload refetches when pageId is set', async () => {
    const page = { content: '', frontmatter: {}, backlinks: [], links: [] }
    vi.stubGlobal('fetch', okFetch(page))
    const { result } = renderHook(() => useWikiPage('w1', 'index'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => { result.current.reload() })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reload is no-op when pageId is null', () => {
    const { result } = renderHook(() => useWikiPage('w1', null))
    result.current.reload()
    expect(fetch).not.toHaveBeenCalled()
  })
})

// ── useGraphData ──────────────────────────────────────────────────────────────

describe('useGraphData', () => {
  it('fetches graph data', async () => {
    const graph = { nodes: [], links: [] }
    vi.stubGlobal('fetch', okFetch(graph))
    const { result } = renderHook(() => useGraphData('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.graph).toEqual(graph)
  })

  it('refetches when the refresh key changes', async () => {
    const first = { nodes: [{ id: 'a' }], links: [] }
    const second = { nodes: [{ id: 'b' }], links: [] }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(first) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(second) })
    )
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useGraphData('w1', refreshKey),
      { initialProps: { refreshKey: 0 } }
    )
    await waitFor(() => expect(result.current.graph).toEqual(first))
    rerender({ refreshKey: 1 })
    await waitFor(() => expect(result.current.graph).toEqual(second))
  })

  it('sets graph to null on failure', async () => {
    vi.stubGlobal('fetch', failFetch(500))
    const { result } = renderHook(() => useGraphData('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.graph).toBeNull()
  })
})

// ── useSearch ─────────────────────────────────────────────────────────────────

describe('useSearch', () => {
  it('debounces search and returns results', async () => {
    const results = [{ id: 'about', title: 'About', type: 'page', excerpt: 'x', tags: [] }]
    vi.stubGlobal('fetch', okFetch(results))
    const { result } = renderHook(() => useSearch('w1'))
    act(() => { result.current.setQuery('about') })
    // Wait for results to be populated (debounce is 250ms)
    await waitFor(() => expect(result.current.results).toEqual(results), { timeout: 2000 })
  }, 3000)

  it('clears results when query is blank', async () => {
    const { result } = renderHook(() => useSearch('w1'))
    act(() => { result.current.setQuery('hello') })
    act(() => { result.current.setQuery('') })
    await waitFor(() => expect(result.current.results).toEqual([]))
  })

  it('clears results on fetch failure', async () => {
    const mockFetch = failFetch(500)
    vi.stubGlobal('fetch', mockFetch)
    const { result } = renderHook(() => useSearch('w1'))
    act(() => { result.current.setQuery('fail') })
    // Wait until the debounced fetch is actually called, THEN wait for searching to settle
    await waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 })
    await waitFor(() => expect(result.current.searching).toBe(false), { timeout: 1000 })
    expect(result.current.results).toEqual([])
  }, 3000)
})

// ── useRawFiles ───────────────────────────────────────────────────────────────

describe('useRawFiles', () => {
  it('fetches raw files and inboxExists', async () => {
    const data = { files: [{ name: 'a.txt', path: 'inbox/a.txt', size: 10, modified: '' }], inboxExists: true }
    vi.stubGlobal('fetch', okFetch(data))
    const { result } = renderHook(() => useRawFiles('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.files).toEqual(data.files)
    expect(result.current.inboxExists).toBe(true)
  })

  it('sets files to [] and inboxExists to null on failure', async () => {
    vi.stubGlobal('fetch', failFetch(500))
    const { result } = renderHook(() => useRawFiles('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.files).toEqual([])
    expect(result.current.inboxExists).toBeNull()
  })
})

// ── useLog ────────────────────────────────────────────────────────────────────

describe('useLog', () => {
  it('fetches log entries', async () => {
    const entries = [{ header: '[2026-05-01] ingest | Source', body: '' }]
    vi.stubGlobal('fetch', okFetch(entries))
    const { result } = renderHook(() => useLog('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toEqual(entries)
  })

  it('returns empty array on failure', async () => {
    vi.stubGlobal('fetch', failFetch(500))
    const { result } = renderHook(() => useLog('w1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toEqual([])
  })
})

// ── useWikiSocket ─────────────────────────────────────────────────────────────

describe('useWikiSocket', () => {
  it('mounts without throwing', () => {
    const { unmount } = renderHook(() => useWikiSocket(vi.fn()))
    expect(() => unmount()).not.toThrow()
  })
})

// ── standalone async functions ────────────────────────────────────────────────

describe('detectIDEs', () => {
  it('returns IDEs on success', async () => {
    vi.stubGlobal('fetch', okFetch([{ id: 'cursor', name: 'Cursor' }]))
    const result = await detectIDEs()
    expect(result).toEqual([{ id: 'cursor', name: 'Cursor' }])
  })

  it('returns [] when response is not ok', async () => {
    vi.stubGlobal('fetch', failFetch(500))
    const result = await detectIDEs()
    expect(result).toEqual([])
  })
})

describe('openInIDE', () => {
  it('resolves on success', async () => {
    vi.stubGlobal('fetch', okFetch({ ok: true }))
    await expect(openInIDE('cursor', '/tmp')).resolves.toBeUndefined()
  })

  it('throws on failure with error message', async () => {
    vi.stubGlobal('fetch', failFetch(400, 'Bad Request', { error: 'Unknown IDE' }))
    await expect(openInIDE('notepad', '/tmp')).rejects.toThrow('Unknown IDE')
  })

  it('throws with fallback message when error field is missing', async () => {
    vi.stubGlobal('fetch', failFetch(500, 'Internal Server Error', {}))
    await expect(openInIDE('cursor', '/tmp')).rejects.toThrow(/500/)
  })
})

describe('pickFolder', () => {
  it('returns the chosen path on success', async () => {
    vi.stubGlobal('fetch', okFetch({ path: '/chosen/folder' }))
    const result = await pickFolder()
    expect(result).toBe('/chosen/folder')
  })

  it('returns null when user cancels', async () => {
    vi.stubGlobal('fetch', failFetch(400, 'Cancelled', { error: 'cancelled' }))
    const result = await pickFolder()
    expect(result).toBeNull()
  })

  it('throws when a non-cancel error occurs', async () => {
    vi.stubGlobal('fetch', failFetch(500, 'Error', { error: 'dialog crashed' }))
    await expect(pickFolder()).rejects.toThrow('dialog crashed')
  })

  it('throws with fallback when error field is missing', async () => {
    vi.stubGlobal('fetch', failFetch(500, 'Error', {}))
    await expect(pickFolder()).rejects.toThrow(/500/)
  })
})

describe('addWiki', () => {
  it('returns wiki config on success', async () => {
    const wiki = { id: 'w1', name: 'Test', color: '#fff', path: '/tmp', mode: 'wiki', stats: null }
    vi.stubGlobal('fetch', okFetch(wiki))
    const result = await addWiki('Test', '/tmp', '#fff', false)
    expect(result).toEqual(wiki)
  })

  it('throws with error message on failure', async () => {
    vi.stubGlobal('fetch', failFetch(400, 'Bad', { error: 'Name required' }))
    await expect(addWiki('', '', '#fff', false)).rejects.toThrow('Name required')
  })

  it('throws with fallback message when error field absent', async () => {
    vi.stubGlobal('fetch', failFetch(500, 'Error', {}))
    await expect(addWiki('Test', '/tmp', '#fff', false)).rejects.toThrow(/500/)
  })
})

describe('removeWiki', () => {
  it('calls DELETE and resolves', async () => {
    const mockFetch = okFetch({})
    vi.stubGlobal('fetch', mockFetch)
    await expect(removeWiki('w1')).resolves.toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith('/api/wikis/w1', { method: 'DELETE' })
  })
})
