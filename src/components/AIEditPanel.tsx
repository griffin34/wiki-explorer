import { useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Wand2,
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  AlertTriangle,
  CheckSquare,
  Square,
  Play,
  Eye,
  FileText,
  Diff,
} from 'lucide-react'
import { api } from '../utils/api'

interface EditHunk {
  line_start: number
  line_end: number
  before: string
  after: string
}

interface PageChange {
  page: string  // e.g., "project-team.md"
  revision: number
  hunks: EditHunk[]
  original_content?: string
  edited_content?: string
}

interface PreviewResult {
  edit_id: string
  instruction: string
  changes: PageChange[]
  affected_pages: string[]
  preview_diff: string
}

interface AIEditPanelProps {
  /** Whether the panel is open */
  isOpen: boolean
  /** Called when the panel should close */
  onClose: () => void
  /** Called after changes are applied */
  onApplyComplete?: () => void
}

/** Simple unified diff display with highlighting */
function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n')

  return (
    <div className="font-mono text-xs leading-relaxed overflow-x-auto">
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

/** Expandable card for a single page change */
function ChangeCard({
  change,
  selected,
  onToggle,
}: {
  change: PageChange
  selected: boolean
  onToggle: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  
  // Extract page name from "page.md" format
  const pageName = change.page.replace(/\.md$/, '')
  
  // Generate diff from hunks
  const generateDiff = (): string => {
    const lines: string[] = [
      `--- ${change.page}`,
      `+++ ${change.page} (revision ${change.revision})`,
    ]
    for (const hunk of change.hunks) {
      lines.push(`@@ -${hunk.line_start},${hunk.line_end} @@`)
      for (const line of hunk.before.split('\n')) {
        lines.push(`- ${line}`)
      }
      for (const line of hunk.after.split('\n')) {
        lines.push(`+ ${line}`)
      }
    }
    return lines.join('\n')
  }

  return (
    <div
      className={`rounded-lg border transition-colors ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-faint)]'
          : 'border-[var(--border)] bg-[var(--bg-surface)]'
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="flex-shrink-0 text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          {selected ? (
            <CheckSquare size={18} className="text-[var(--accent)]" />
          ) : (
            <Square size={18} />
          )}
        </button>

        {/* Page info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[var(--text-muted)] flex-shrink-0" />
            <span className="font-medium text-[var(--text-primary)] truncate">{pageName}</span>
            <span className="text-xs text-[var(--text-muted)]">rev {change.revision}</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] truncate">{change.hunks.length} changes</p>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
        >
          <Diff size={12} />
          Diff
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {/* Expanded diff view */}
      {expanded && (
        <div className="border-t border-[var(--border)] max-h-64 overflow-y-auto">
          <DiffViewer diff={generateDiff()} />
        </div>
      )}
    </div>
  )
}

export default function AIEditPanel({ isOpen, onClose, onApplyComplete }: AIEditPanelProps) {
  const { wikiId = '' } = useParams<{ wikiId: string }>()

  const [instruction, setInstruction] = useState('')
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const resetState = useCallback(() => {
    setPreviewResult(null)
    setSelectedSlugs(new Set())
    setError(null)
    setSuccess(null)
  }, [])

  const handleClose = useCallback(() => {
    resetState()
    setInstruction('')
    onClose()
  }, [resetState, onClose])

  const handlePreview = useCallback(async () => {
    if (!instruction.trim() || previewing) return

    setPreviewing(true)
    setError(null)
    setSuccess(null)
    resetState()

    try {
      const res = await fetch(api('/api/ai/edit/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wiki_id: wikiId,
          instruction: instruction.trim(),
        }),
      })

      if (res.status === 503) {
        throw new Error('AI agent service is not running. Start it with `./start-ai.sh`.')
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Preview failed (${res.status})`)
      }

      const data = (await res.json()) as PreviewResult

      if (data.changes.length === 0) {
        setError('No matching pages found for this instruction.')
      } else {
        setPreviewResult(data)
        // Select all changes by default
        setSelectedSlugs(new Set(data.changes.map((c) => c.page)))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview changes')
    } finally {
      setPreviewing(false)
    }
  }, [instruction, previewing, wikiId, resetState])

  const handleApply = useCallback(
    async (applyAll: boolean) => {
      if (!previewResult || applying) return

      const pagesToApply = applyAll
        ? previewResult.changes.map((c) => c.page)
        : Array.from(selectedSlugs)

      if (pagesToApply.length === 0) {
        setError('No changes selected to apply.')
        return
      }

      setApplying(true)
      setError(null)

      try {
        const res = await fetch(api('/api/ai/edit/apply'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wiki_id: wikiId,
            edit_id: previewResult.edit_id,
            selected_pages: pagesToApply,
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Apply failed (${res.status})`)
        }

        const data = (await res.json()) as { applied_pages: string[]; revision_count: number }

        setSuccess(`Successfully applied ${data.applied_pages.length} changes.`)

        // Clear state after successful apply
        setTimeout(() => {
          handleClose()
          onApplyComplete?.()
        }, 1500)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to apply changes')
      } finally {
        setApplying(false)
      }
    },
    [previewResult, applying, selectedSlugs, wikiId, handleClose, onApplyComplete]
  )

  const toggleSelection = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (!previewResult) return
    if (selectedSlugs.size === previewResult.changes.length) {
      setSelectedSlugs(new Set())
    } else {
      setSelectedSlugs(new Set(previewResult.changes.map((c) => c.page)))
    }
  }, [previewResult, selectedSlugs.size])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-base)] rounded-xl shadow-2xl border border-[var(--border)] max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[var(--accent-faint)]">
              <Wand2 size={18} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="font-semibold text-[var(--text-primary)]">AI Bulk Edit</h2>
              <p className="text-xs text-[var(--text-muted)]">Make changes across multiple pages</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Instruction input */}
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
            Describe the changes you want to make
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handlePreview()
                }
              }}
              placeholder='e.g., "Replace all mentions of Jessica with Amanda" or "Add #reviewed tag to all entity pages"'
              className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] text-sm"
              disabled={previewing}
            />
            <button
              onClick={() => void handlePreview()}
              disabled={!instruction.trim() || previewing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {previewing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Eye size={16} />
              )}
              Preview
            </button>
          </div>
        </div>

        {/* Error/Success messages */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-[var(--error-faint)] border border-[var(--error-border)] text-[var(--error)] text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {success && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-[var(--success-faint)] border border-[var(--success-border)] text-[var(--success)] text-sm flex items-center gap-2">
            <Check size={16} />
            {success}
          </div>
        )}

        {/* Changes list */}
        {previewResult && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Selection header */}
            <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleAll}
                  className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                >
                  {selectedSlugs.size === previewResult.changes.length ? (
                    <CheckSquare size={16} className="text-[var(--accent)]" />
                  ) : (
                    <Square size={16} />
                  )}
                </button>
                <span className="text-sm text-[var(--text-secondary)]">
                  {selectedSlugs.size} of {previewResult.changes.length} pages selected
                </span>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                Click on a card to expand diff
              </span>
            </div>

            {/* Scrollable changes */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {previewResult.changes.map((change) => (
                <ChangeCard
                  key={change.page}
                  change={change}
                  selected={selectedSlugs.has(change.page)}
                  onToggle={() => toggleSelection(change.page)}
                />
              ))}
            </div>

            {/* Action buttons */}
            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleApply(false)}
                  disabled={applying || selectedSlugs.size === 0}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-faint)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applying ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Apply Selected ({selectedSlugs.size})
                </button>
                <button
                  onClick={() => void handleApply(true)}
                  disabled={applying}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applying ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Apply All ({previewResult.changes.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!previewResult && !previewing && !error && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-[var(--bg-elevated)] mb-4">
              <Wand2 size={32} className="text-[var(--text-muted)]" />
            </div>
            <p className="text-[var(--text-secondary)] mb-1">
              Enter an instruction to preview changes
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">
              The AI will find relevant pages and show you a diff of proposed changes before applying
              them.
            </p>
          </div>
        )}

        {/* Loading state */}
        {previewing && (
          <div className="flex-1 flex flex-col items-center justify-center py-12">
            <Loader2 size={32} className="animate-spin text-[var(--accent)] mb-4" />
            <p className="text-[var(--text-secondary)]">Analyzing pages and generating changes...</p>
          </div>
        )}
      </div>
    </div>
  )
}
