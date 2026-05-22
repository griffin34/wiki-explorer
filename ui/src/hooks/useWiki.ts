import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  VaultConfig,
  WikiPageMeta,
  WikiPageDetail,
  GraphData,
  SearchResult,
  RawFile,
  LogEntry,
  WsEvent,
} from '../types'

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const vaultBase = (vaultId: string) => `/api/vaults/${vaultId}`

// ─── Vaults ───────────────────────────────────────────────────────────────────

export function useVaults() {
  const [vaults, setVaults] = useState<VaultConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<VaultConfig[]>('/api/vaults')
      setVaults(data)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { vaults, loading, error, reload: load }
}

export async function addVault(name: string, vaultPath: string, color: string, create: boolean): Promise<VaultConfig> {
  const res = await fetch('/api/vaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, vaultPath, color, create }),
  })
  const data = (await res.json()) as VaultConfig & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)
  return data
}

export async function removeVault(id: string): Promise<void> {
  await fetch(`/api/vaults/${id}`, { method: 'DELETE' })
}

// ─── Page list ────────────────────────────────────────────────────────────────

export function usePageList(vaultId: string) {
  const [pages, setPages] = useState<WikiPageMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<WikiPageMeta[]>(`${vaultBase(vaultId)}/wiki`)
      setPages(data)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [vaultId])

  useEffect(() => { load() }, [load])
  return { pages, loading, error, reload: load }
}

// ─── Single page ──────────────────────────────────────────────────────────────

export function useWikiPage(vaultId: string, pageId: string | null) {
  const [page, setPage] = useState<WikiPageDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchJSON<WikiPageDetail>(`${vaultBase(vaultId)}/wiki/${id}`)
      setPage(data)
    } catch (e) {
      setError(String(e))
      setPage(null)
    } finally {
      setLoading(false)
    }
  }, [vaultId])

  useEffect(() => {
    if (pageId) load(pageId)
    else setPage(null)
  }, [pageId, load])

  return { page, loading, error, reload: () => pageId && load(pageId) }
}

// ─── Graph ────────────────────────────────────────────────────────────────────

export function useGraphData(vaultId: string) {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<GraphData>(`${vaultBase(vaultId)}/graph`)
      setGraph(data)
    } catch {
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [vaultId])

  useEffect(() => { load() }, [load])
  return { graph, loading, reload: load }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function useSearch(vaultId: string) {
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
        const data = await fetchJSON<SearchResult[]>(`${vaultBase(vaultId)}/search?q=${encodeURIComponent(query)}`)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, vaultId])

  return { query, setQuery, results, searching }
}

// ─── Raw files ────────────────────────────────────────────────────────────────

export function useRawFiles(vaultId: string) {
  const [files, setFiles] = useState<RawFile[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<RawFile[]>(`${vaultBase(vaultId)}/raw`)
      setFiles(data)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [vaultId])

  useEffect(() => { load() }, [load])
  return { files, loading, reload: load }
}

// ─── Log ──────────────────────────────────────────────────────────────────────

export function useLog(vaultId: string) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchJSON<LogEntry[]>(`${vaultBase(vaultId)}/log`)
      setEntries(data)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [vaultId])

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
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${window.location.host}/ws`)
      ws.onmessage = (e) => {
        try { onEventRef.current(JSON.parse(e.data as string) as WsEvent) } catch {}
      }
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 2000) }
    }

    connect()
    return () => { clearTimeout(reconnectTimeout); ws?.close() }
  }, [])
}
