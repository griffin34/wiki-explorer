import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  History,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Check,
  User,
  Wand2,
  Calendar,
  FileText,
  RefreshCw,
} from 'lucide-react'
import { api } from '../utils/api'

export interface Revision {
  id: string
  timestamp: string
  type: 'manual' | 'ai_bulk'
  reason?: string
  diff?: string
}

interface PageHistoryProps {
  /** Page slug/path */
  slug: string
  /** Whether the history panel is visible */
  isOpen?: boolean
  /** Called when a revert succeeds */
  onRevert?: () => void
}

/** Simple unified diff display with highlighting */
function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n')

  return (
    <div className="font-mono text-xs leading-relaxed overflow-x-auto bg-[var(--bg-base)] rounded border border-[var(--border)]">
      {lines.map((line, i) => {
        let className = 'px-3 py-0.5 whitespace-pre'
        if (line.startsWith('+') && !line.startsWith('+++')) {
          className += ' bg-[var(--success-faint,rgba(166,227,161,0.12))] text-[var(--success,#a6e3a1)]'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          className += ' bg-[var(--error-faint,rgba(243,139,168,0.12))] text-[var(--error,#f38ba8)]'
        } else if (line.startsWith('@@')) {
          className += ' text-[var(--accent)] bg-[var(--accent-faint)]'
        } else {
          className += ' text-[var(--text-muted)]'
        }
        return (
          <div key={i} className={className}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  } else if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
}

function RevisionCard({
  revision,
  isFirst,
  isLast,
  onRevert,
  reverting,
}: {
  revision: Revision
  isFirst: boolean
  isLast: boolean
  onRevert: () => void
  reverting: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const TypeIcon = revision.type === 'ai_bulk' ? Wand2 : User

  return (
    <div className="relative">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-[15px] top-10 bottom-0 w-0.5 bg-[var(--border)]" />
      )}

      <div className="flex gap-3">
        {/* Timeline dot */}
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            revision.type === 'ai_bulk'
              ? 'bg-[var(--accent-faint)] text-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
          }`}
        >
          <TypeIcon size={14} />
        </div>

        {/* Content */}
        <div className="flex-1 pb-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between p-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {revision.type === 'ai_bulk' ? 'AI Bulk Edit' : 'Manual Edit'}
                  </span>
                  {isFirst && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--accent-faint)] text-[var(--accent)] font-medium">
                      Latest
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Calendar size={11} />
                  {formatDate(revision.timestamp)}
                </div>
                {revision.reason && (
                  <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                    {revision.reason}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                {revision.diff && (
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    <FileText size={12} />
                    Diff
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                )}
                {!isFirst && (
                  <button
                    onClick={onRevert}
                    disabled={reverting}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--warning)] hover:bg-[var(--warning-faint)] rounded transition-colors disabled:opacity-50"
                    title="Revert to this version"
                  >
                    {reverting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    Revert
                  </button>
                )}
              </div>
            </div>

            {/* Expanded diff */}
            {expanded && revision.diff && (
              <div className="border-t border-[var(--border)] p-3 max-h-64 overflow-y-auto">
                <DiffViewer diff={revision.diff} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PageHistory({ slug, isOpen = true, onRevert }: PageHistoryProps) {
  const { wikiId = '' } = useParams<{ wikiId: string }>()

  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [revertSuccess, setRevertSuccess] = useState(false)
  const [filter, setFilter] = useState<'all' | 'manual' | 'ai_bulk'>('all')

  const fetchHistory = useCallback(async () => {
    if (!wikiId || !slug) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(
        api(`/api/wikis/${wikiId}/pages/${encodeURIComponent(slug)}/history`)
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load history (${res.status})`)
      }

      const data = (await res.json()) as { revisions: Revision[] }
      setRevisions(data.revisions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [wikiId, slug])

  useEffect(() => {
    if (isOpen) {
      void fetchHistory()
    }
  }, [isOpen, fetchHistory])

  const handleRevert = useCallback(
    async (revisionId: string) => {
      if (revertingId) return

      setRevertingId(revisionId)
      setError(null)
      setRevertSuccess(false)

      try {
        const res = await fetch(
          api(`/api/wikis/${wikiId}/pages/${encodeURIComponent(slug)}/revert`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision_id: revisionId }),
          }
        )

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed to revert (${res.status})`)
        }

        setRevertSuccess(true)
        // Refresh history
        await fetchHistory()
        onRevert?.()

        // Clear success message after 3s
        setTimeout(() => setRevertSuccess(false), 3000)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revert')
      } finally {
        setRevertingId(null)
      }
    },
    [revertingId, wikiId, slug, fetchHistory, onRevert]
  )

  const filteredRevisions = revisions.filter((r) => {
    if (filter === 'all') return true
    return r.type === filter
  })

  if (!isOpen) return null

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[var(--accent)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Page History</h3>
          </div>
          <button
            onClick={() => void fetchHistory()}
            disabled={loading}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            title="Refresh history"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(['all', 'manual', 'ai_bulk'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                filter === f
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f === 'all' ? 'All' : f === 'manual' ? 'Manual' : 'AI Bulk'}
            </button>
          ))}
        </div>
      </div>

      {/* Success message */}
      {revertSuccess && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-[var(--success-faint)] border border-[var(--success-border)] text-[var(--success)] text-sm flex items-center gap-2">
          <Check size={14} />
          Successfully reverted to previous version
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-[var(--error-faint)] border border-[var(--error-border)] text-[var(--error)] text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-[var(--accent)] mb-3" />
            <p className="text-sm text-[var(--text-muted)]">Loading history...</p>
          </div>
        ) : filteredRevisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-3 rounded-full bg-[var(--bg-elevated)] mb-3">
              <History size={24} className="text-[var(--text-muted)]" />
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-1">No revisions found</p>
            <p className="text-xs text-[var(--text-muted)]">
              {filter !== 'all'
                ? `No ${filter === 'manual' ? 'manual' : 'AI bulk'} edits recorded`
                : 'Edit this page to create the first revision'}
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {filteredRevisions.map((revision, index) => (
              <RevisionCard
                key={revision.id}
                revision={revision}
                isFirst={index === 0}
                isLast={index === filteredRevisions.length - 1}
                onRevert={() => void handleRevert(revision.id)}
                reverting={revertingId === revision.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
