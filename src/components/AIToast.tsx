import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X, Loader2, CheckCircle2, XCircle, FileText, Sparkles } from 'lucide-react'
import { useWikiSocket } from '../hooks/useWiki'
import type { WsEvent } from '../types'

interface Toast {
  id: string
  type: 'processing' | 'done' | 'error' | 'wiki-created'
  wikiId: string
  file?: string
  title?: string
  page?: string
  error?: string
  ts: number
}

export default function AIToast() {
  const navigate = useNavigate()
  const { id: currentWikiId } = useParams<{ id: string }>()
  const [toasts, setToasts] = useState<Toast[]>([])

  const handleEvent = useCallback(
    (e: WsEvent) => {
      const now = Date.now()
      if (e.event === 'ai:ingest:start') {
        setToasts((prev) => {
          // Don't add if already processing this file
          if (prev.some((t) => t.file === e.data.file && t.type === 'processing')) return prev
          return [
            ...prev,
            {
              id: `${e.data.wikiId}-${e.data.file}-${now}`,
              type: 'processing',
              wikiId: e.data.wikiId,
              file: e.data.file,
              ts: now,
            },
          ]
        })
      } else if (e.event === 'ai:ingest:done') {
        setToasts((prev) =>
          prev.map((t) =>
            t.file === e.data.file && t.type === 'processing'
              ? { ...t, type: 'done', page: e.data.wikiPage, ts: now }
              : t
          )
        )
      } else if (e.event === 'ai:ingest:error') {
        setToasts((prev) =>
          prev.map((t) =>
            t.file === e.data.file && t.type === 'processing'
              ? { ...t, type: 'error', error: e.data.error, ts: now }
              : t
          )
        )
      } else if (e.event === 'ai:wiki:created') {
        setToasts((prev) => [
          ...prev,
          {
            id: `wiki-${e.data.wikiId}-${e.data.page}-${now}`,
            type: 'wiki-created',
            wikiId: e.data.wikiId,
            title: e.data.title,
            page: e.data.page,
            ts: now,
          },
        ])
      }
    },
    []
  )

  useWikiSocket(handleEvent)

  // Auto-remove completed toasts after 8 seconds
  useEffect(() => {
    if (!toasts.length) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - 8000
      setToasts((prev) => prev.filter((t) => t.type === 'processing' || t.ts > cutoff))
    }, 1000)
    return () => clearInterval(timer)
  }, [toasts.length])

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  if (!toasts.length) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 p-3 rounded-lg shadow-lg border backdrop-blur-sm animate-slide-in ${
            toast.type === 'processing'
              ? 'bg-[var(--warning-faint,rgba(249,226,175,0.95))] border-[var(--warning,#f9e2af)]'
              : toast.type === 'done'
              ? 'bg-[var(--success-faint,rgba(166,227,161,0.95))] border-[var(--success,#a6e3a1)]'
              : toast.type === 'wiki-created'
              ? 'bg-[var(--accent-faint,rgba(137,180,250,0.95))] border-[var(--accent)]'
              : 'bg-[var(--error-faint,rgba(243,139,168,0.95))] border-[var(--error,#f38ba8)]'
          }`}
        >
          {toast.type === 'processing' ? (
            <Loader2 size={18} className="text-[var(--warning,#f9e2af)] animate-spin flex-shrink-0 mt-0.5" />
          ) : toast.type === 'done' ? (
            <CheckCircle2 size={18} className="text-[var(--success,#a6e3a1)] flex-shrink-0 mt-0.5" />
          ) : toast.type === 'wiki-created' ? (
            <Sparkles size={18} className="text-[var(--accent)] flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle size={18} className="text-[var(--error,#f38ba8)] flex-shrink-0 mt-0.5" />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {toast.type === 'processing' && 'Processing file...'}
              {toast.type === 'done' && 'File processed'}
              {toast.type === 'wiki-created' && 'Wiki page created!'}
              {toast.type === 'error' && 'Processing failed'}
            </p>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {toast.file && (
                <span className="flex items-center gap-1">
                  <FileText size={10} />
                  {toast.file.split('/').pop()}
                </span>
              )}
              {toast.title && toast.page && (
                <button
                  onClick={() => navigate(`/wiki/${toast.wikiId}/page/${toast.page}`)}
                  className="hover:underline text-[var(--accent)] font-medium"
                >
                  {toast.title}
                </button>
              )}
              {toast.error && <span className="text-[var(--error,#f38ba8)]">{toast.error}</span>}
            </p>
            {toast.type === 'done' && toast.page && currentWikiId === toast.wikiId && (
              <button
                onClick={() => navigate(`/wiki/${toast.wikiId}/page/${toast.page}`)}
                className="text-xs text-[var(--success,#a6e3a1)] hover:underline mt-1"
              >
                View wiki page →
              </button>
            )}
          </div>

          <button
            onClick={() => dismiss(toast.id)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
