import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  WikiConfig,
  WikiPageMeta,
  WikiPageDetail,
  GraphData,
  SearchResult,
  RawFile,
  LogEntry,
  WsEvent,
} from '../types'
import { api, wsUrl } from '../utils/api'

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(api(url))
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const wikiBase = (wikiId: string) => `/api/wikis/${wikiId}`

// ─── Wikis ────────────────────────────────────────────────────────────────────

export function useWikis() {
  const [wikis, setWikis] = useState<WikiConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<WikiConfig[]>('/api/wikis')
      setWikis(data)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { wikis, loading, error, reload: load }
}

export interface IDEInfo {
  id: string
  name: string
}

export async function detectIDEs(): Promise<IDEInfo[]> {
  const res = await fetch(api('/api/detect-ides'))
  if (!res.ok) return []
  return res.json() as Promise<IDEInfo[]>
}

export async function openInIDE(ide: string, folderPath: string): Promise<void> {
  const res = await fetch(api('/api/open-in-ide'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ide, path: folderPath }),
  })
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    throw new Error(data.error ?? `Server error ${res.status}`)
  }
}

export async function pickFolder(): Promise<string | null> {
  const res = await fetch(api('/api/pick-folder'))
  if (!res.ok) {
    const data = (await res.json()) as { error?: string }
    if (data.error === 'cancelled') return null
    throw new Error(data.error ?? `Server error ${res.status}`)
  }
  const data = (await res.json()) as { path: string }
  return data.path
}

export async function addWiki(name: string, wikiPath: string, color: string, create: boolean): Promise<WikiConfig> {
  const res = await fetch(api('/api/wikis'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, wikiPath, color, create }),
  })
  const data = (await res.json()) as WikiConfig & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)
  return data
}

export async function removeWiki(id: string): Promise<void> {
  await fetch(api(`/api/wikis/${id}`), { method: 'DELETE' })
}

// ─── Page list ────────────────────────────────────────────────────────────────

export function usePageList(wikiId: string) {
  const [pages, setPages] = useState<WikiPageMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<WikiPageMeta[]>(`${wikiBase(wikiId)}/wiki`)
      setPages(data)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [wikiId])

  useEffect(() => { load() }, [load])
  return { pages, loading, error, reload: load }
}

// ─── Single page ──────────────────────────────────────────────────────────────

export function useWikiPage(wikiId: string, pageId: string | null) {
  const [page, setPage] = useState<WikiPageDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchJSON<WikiPageDetail>(`${wikiBase(wikiId)}/wiki/${id}`)
      setPage(data)
    } catch (e) {
      setError(String(e))
      setPage(null)
    } finally {
      setLoading(false)
    }
  }, [wikiId])

  useEffect(() => {
    if (pageId) load(pageId)
    else setPage(null)
  }, [pageId, load])

  return { page, loading, error, reload: () => pageId && load(pageId) }
}

// ─── Graph ────────────────────────────────────────────────────────────────────

export function useGraphData(wikiId: string, refreshKey = 0) {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<GraphData>(`${wikiBase(wikiId)}/graph`)
      setGraph(data)
    } catch {
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [wikiId])

  useEffect(() => { load() }, [load, refreshKey])
  return { graph, loading, reload: load }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function useSearch(wikiId: string) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await fetchJSON<SearchResult[]>(`${wikiBase(wikiId)}/search?q=${encodeURIComponent(query)}`)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    /* v8 ignore next */
  return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, wikiId])

  return { query, setQuery, results, searching }
}

// ─── Raw files ────────────────────────────────────────────────────────────────

export function useRawFiles(wikiId: string) {
  const [files, setFiles] = useState<RawFile[]>([])
  const [inboxExists, setInboxExists] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<{ files: RawFile[]; inboxExists: boolean }>(`${wikiBase(wikiId)}/raw`)
      setFiles(data.files)
      setInboxExists(data.inboxExists)
    } catch {
      setFiles([])
      setInboxExists(null)
    } finally {
      setLoading(false)
    }
  }, [wikiId])

  useEffect(() => { load() }, [load])
  return { files, inboxExists, loading, reload: load }
}

// ─── Log ──────────────────────────────────────────────────────────────────────

export function useLog(wikiId: string) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<LogEntry[]>(`${wikiBase(wikiId)}/log`)
      setEntries(data)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [wikiId])

  useEffect(() => { load() }, [load])
  return { entries, loading, reload: load }
}

// ─── WebSocket live updates ───────────────────────────────────────────────────

export function useWikiSocket(onEvent: (e: WsEvent) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    let ws: WebSocket
    let reconnectTimeout: ReturnType<typeof setTimeout>

    function connect() {
      /* v8 ignore next */
      ws = new WebSocket(wsUrl('/ws'))
      /* v8 ignore next 3 */
      ws.onmessage = (e) => {
        try { onEventRef.current(JSON.parse(e.data as string) as WsEvent) } catch {}
      }
      /* v8 ignore next */
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 2000) }
    }

    connect()
    /* v8 ignore next */
    return () => { clearTimeout(reconnectTimeout); ws?.close() }
  }, [])
}
