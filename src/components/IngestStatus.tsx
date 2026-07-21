import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, XCircle, FileText, Brain, Zap, ZapOff } from 'lucide-react'
import { useWikiSocket } from '../hooks/useWiki'
import type { WsEvent } from '../types'

interface IngestItem {
  file: string
  status: 'processing' | 'done' | 'error'
  wikiPage?: string
  error?: string
  ts: number
}

interface Props {
  wikiId: string
}

export default function IngestStatus({ wikiId }: Props) {
  const navigate = useNavigate()
  const [items, setItems] = useState<IngestItem[]>([])
  const [newPageToast, setNewPageToast] = useState<{ title: string; page: string } | null>(null)
  const [aiStatus, setAiStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [recentCount, setRecentCount] = useState(0)

  // Check AI service health periodically
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/api/ai/status')
        if (res.ok) {
          const data = await res.json()
          setAiStatus(data.status === 'ok' || data.status === 'degraded' ? 'online' : 'offline')
        } else {
          setAiStatus('offline')
        }
      } catch {
        setAiStatus('offline')
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 30000) // Check every 30s
    return () => clearInterval(interval)
  }, [])

  const handleEvent = useCallback(
    (e: WsEvent) => {
      if (e.event === 'ai:ingest:start' && e.data.wikiId === wikiId) {
        setItems((prev) => {
          const existing = prev.findIndex((i) => i.file === e.data.file)
          const item: IngestItem = { file: e.data.file, status: 'processing', ts: Date.now() }
          if (existing >= 0) {
            const next = [...prev]
            next[existing] = item
            return next
          }
          return [...prev, item]
        })
      } else if (e.event === 'ai:ingest:done' && e.data.wikiId === wikiId) {
        setItems((prev) =>
          prev.map((i) =>
            i.file === e.data.file
              ? { ...i, status: 'done', wikiPage: e.data.wikiPage, ts: Date.now() }
              : i
          )
        )
        setRecentCount((c) => c + 1)
      } else if (e.event === 'ai:ingest:error' && e.data.wikiId === wikiId) {
        setItems((prev) =>
          prev.map((i) =>
            i.file === e.data.file
              ? { ...i, status: 'error', error: e.data.error, ts: Date.now() }
              : i
          )
        )
      } else if (e.event === 'ai:wiki:created' && e.data.wikiId === wikiId) {
        setNewPageToast({ title: e.data.title, page: e.data.page })
        setTimeout(() => setNewPageToast(null), 8000)
      }
    },
    [wikiId]
  )

  useWikiSocket(handleEvent)

  // Auto-remove done/error items after 15 seconds (longer so user sees them)
  useEffect(() => {
    if (!items.length) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - 15_000
      setItems((prev) => prev.filter((i) => i.status === 'processing' || i.ts > cutoff))
    }, 1000)
    return () => clearInterval(timer)
  }, [items.length])

  // Reset recent count after 60 seconds of no activity
  useEffect(() => {
    if (recentCount === 0) return
    const timer = setTimeout(() => setRecentCount(0), 60000)
    return () => clearTimeout(timer)
  }, [recentCount])

  const activeCount = items.filter((i) => i.status === 'processing').length

  return (
    <div className="border-t border-[var(--border)] py-2">
      {/* Section header - always visible */}
      <div className="flex items-center gap-2 px-4 pb-1.5">
        <Brain size={12} className="text-[var(--text-muted)]" />
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex-1">
          AI Processing
        </p>
        {activeCount > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--accent)]">{activeCount} file{activeCount > 1 ? 's' : ''}</span>
            <Loader2 size={12} className="text-[var(--accent)] animate-spin" />
          </div>
        ) : aiStatus === 'checking' ? (
          <Loader2 size={12} className="text-[var(--text-muted)] animate-spin" />
        ) : aiStatus === 'online' ? (
          <div className="flex items-center gap-1">
            {recentCount > 0 && (
              <span className="text-[10px] text-[var(--success,#a6e3a1)]">{recentCount} processed</span>
            )}
            <Zap size={12} className="text-[var(--success,#a6e3a1)]" />
          </div>
        ) : (
          <div className="flex items-center gap-1" title="AI service offline - run ./start-ai.sh">
            <span className="text-[10px] text-[var(--text-muted)]">offline</span>
            <ZapOff size={12} className="text-[var(--text-muted)]" />
          </div>
        )}
      </div>

      {/* Offline hint */}
      {aiStatus === 'offline' && !items.length && (
        <div className="mx-2 px-2.5 py-1.5 rounded bg-[var(--bg-elevated)] text-[10px] text-[var(--text-muted)]">
          Start AI with <code className="bg-[var(--bg-base)] px-1 rounded">./start-ai.sh</code>
        </div>
      )}

      {/* New wiki page toast */}
      {newPageToast && (
        <div className="mx-2 mb-1.5 px-2.5 py-1.5 rounded bg-[var(--accent-faint)] border border-[var(--accent-border)] text-xs text-[var(--accent)] animate-pulse">
          ✦ New page created:{' '}
          <button
            onClick={() => navigate(`/wiki/${wikiId}/page/${newPageToast.page}`)}
            className="underline font-medium"
          >
            {newPageToast.title}
          </button>
        </div>
      )}

      {/* Item list */}
      <div className="px-2 space-y-0.5">
        {items.map((item) => (
          <div
            key={item.file}
            className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${
              item.status === 'processing'
                ? 'bg-[var(--warning-faint,rgba(249,226,175,0.12))]'
                : item.status === 'done'
                ? 'bg-[var(--success-faint,rgba(166,227,161,0.12))]'
                : 'bg-[var(--error-faint,rgba(243,139,168,0.12))]'
            }`}
          >
            <FileText
              size={11}
              className={`mt-0.5 flex-shrink-0 ${
                item.status === 'processing'
                  ? 'text-[var(--warning,#f9e2af)]'
                  : item.status === 'done'
                  ? 'text-[var(--success,#a6e3a1)]'
                  : 'text-[var(--error,#f38ba8)]'
              }`}
            />
            <div className="min-w-0 flex-1">
              <span className="truncate block text-[var(--text-secondary)]" title={item.file}>
                {item.file.split('/').pop()}
              </span>
              {item.status === 'processing' && (
                <span className="text-[var(--warning,#f9e2af)] opacity-80">Processing…</span>
              )}
              {item.status === 'done' && item.wikiPage && (
                <button
                  onClick={() => navigate(`/wiki/${wikiId}/page/${item.wikiPage}`)}
                  className="text-[var(--success,#a6e3a1)] hover:underline"
                >
                  → wiki page
                </button>
              )}
              {item.status === 'done' && !item.wikiPage && (
                <span className="text-[var(--success,#a6e3a1)] opacity-80">Done</span>
              )}
              {item.status === 'error' && (
                <span className="text-[var(--error,#f38ba8)] truncate block" title={item.error}>
                  {item.error}
                </span>
              )}
            </div>
            {item.status === 'processing' ? (
              <Loader2 size={10} className="mt-0.5 flex-shrink-0 text-[var(--warning,#f9e2af)] animate-spin" />
            ) : item.status === 'done' ? (
              <CheckCircle2 size={10} className="mt-0.5 flex-shrink-0 text-[var(--success,#a6e3a1)]" />
            ) : (
              <XCircle size={10} className="mt-0.5 flex-shrink-0 text-[var(--error,#f38ba8)]" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
