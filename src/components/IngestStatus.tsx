import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, XCircle, FileText, Brain } from 'lucide-react'
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
        setTimeout(() => setNewPageToast(null), 5000)
      }
    },
    [wikiId]
  )

  useWikiSocket(handleEvent)

  // Auto-remove done/error items after 10 seconds
  useEffect(() => {
    if (!items.length) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - 10_000
      setItems((prev) => prev.filter((i) => i.status === 'processing' || i.ts > cutoff))
    }, 1000)
    return () => clearInterval(timer)
  }, [items.length])

  if (!items.length && !newPageToast) return null

  const activeCount = items.filter((i) => i.status === 'processing').length
  const allDone = items.length > 0 && activeCount === 0

  return (
    <div className="border-t border-[var(--border)] py-2">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 pb-1.5">
        <Brain size={12} className="text-[var(--text-muted)]" />
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex-1">
          AI Processing
        </p>
        {activeCount > 0 ? (
          <Loader2 size={12} className="text-[var(--accent)] animate-spin" />
        ) : allDone ? (
          <CheckCircle2 size={12} className="text-[var(--success,#a6e3a1)]" />
        ) : null}
      </div>

      {/* New wiki page toast */}
      {newPageToast && (
        <div className="mx-2 mb-1.5 px-2.5 py-1.5 rounded bg-[var(--accent-faint)] border border-[var(--accent-border)] text-xs text-[var(--accent)]">
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
