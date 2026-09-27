import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import {
  Edit3,
  Eye,
  Save,
  X,
  Loader2,
  AlertTriangle,
  Check,
  Columns,
  FileText,
} from 'lucide-react'
import { api } from '../utils/api'

interface PageEditorProps {
  /** Initial markdown content */
  initialContent: string
  /** Page slug/path */
  slug: string
  /** Called when save succeeds */
  onSave?: (newContent: string, reason?: string) => void
  /** Called when edit mode is exited without saving */
  onCancel?: () => void
  /** Whether to start in edit mode */
  startInEditMode?: boolean
}

type ViewMode = 'view' | 'edit' | 'split'

export default function PageEditor({
  initialContent,
  slug,
  onSave,
  onCancel,
  startInEditMode = false,
}: PageEditorProps) {
  const { wikiId = '' } = useParams<{ wikiId: string }>()
  
  const [content, setContent] = useState(initialContent)
  const [mode, setMode] = useState<ViewMode>(startInEditMode ? 'split' : 'view')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasUnsavedChanges = content !== initialContent

  // Reset content when initialContent changes
  useEffect(() => {
    setContent(initialContent)
  }, [initialContent])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (mode !== 'view' && hasUnsavedChanges) {
          void handleSave()
        }
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelClick()
      }
    }

    if (mode !== 'view') {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mode, hasUnsavedChanges, content, reason])

  // Warn about unsaved changes on navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges && mode !== 'view') {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges, mode])

  const handleSave = useCallback(async () => {
    if (saving || !hasUnsavedChanges) return

    setSaving(true)
    setError(null)
    setSaveSuccess(false)

    try {
      const res = await fetch(api(`/api/wikis/${wikiId}/pages/${encodeURIComponent(slug)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          reason: reason.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to save (${res.status})`)
      }

      setSaveSuccess(true)
      setReason('')
      onSave?.(content, reason.trim() || undefined)

      // Auto-hide success after 2s
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [saving, hasUnsavedChanges, wikiId, slug, content, reason, onSave])

  const handleCancelClick = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowUnsavedWarning(true)
    } else {
      setMode('view')
      onCancel?.()
    }
  }, [hasUnsavedChanges, onCancel])

  const confirmDiscard = useCallback(() => {
    setContent(initialContent)
    setReason('')
    setShowUnsavedWarning(false)
    setMode('view')
    onCancel?.()
  }, [initialContent, onCancel])

  const handleEditClick = useCallback(() => {
    setMode('split')
    // Focus textarea after mode change
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  // Process wiki links for preview
  const processWikiLinks = (md: string): string => {
    return md.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_match, target, label) => {
      const display = label ?? target
      const href = `/wiki/${wikiId}/page/${target.trim()}`
      return `<a href="${href}" class="wiki-link">${display}</a>`
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center gap-2">
          {/* Mode toggle buttons */}
          <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setMode('view')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                mode === 'view'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
              title="View mode"
            >
              <Eye size={14} />
              View
            </button>
            <button
              onClick={handleEditClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-l border-[var(--border)] transition-colors ${
                mode === 'edit'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
              title="Edit mode"
            >
              <Edit3 size={14} />
              Edit
            </button>
            <button
              onClick={() => setMode('split')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-l border-[var(--border)] transition-colors ${
                mode === 'split'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
              title="Split view"
            >
              <Columns size={14} />
              Split
            </button>
          </div>

          {/* Unsaved indicator */}
          {hasUnsavedChanges && mode !== 'view' && (
            <span className="text-xs text-[var(--warning)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
              Unsaved
            </span>
          )}

          {/* Save success indicator */}
          {saveSuccess && (
            <span className="text-xs text-[var(--success)] flex items-center gap-1">
              <Check size={12} />
              Saved
            </span>
          )}
        </div>

        {/* Right side: Save/Cancel */}
        {mode !== 'view' && (
          <div className="flex items-center gap-2">
            {/* Reason input */}
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Edit reason (optional)"
              className="px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] w-48 focus:outline-none focus:border-[var(--accent)]"
            />

            <button
              onClick={() => void handleSave()}
              disabled={saving || !hasUnsavedChanges}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Save (Cmd+S)"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>

            <button
              onClick={handleCancelClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              title="Cancel (Esc)"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-[var(--error-faint)] border-b border-[var(--error-border)] text-[var(--error)] text-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Editor pane */}
        {(mode === 'edit' || mode === 'split') && (
          <div className={`${mode === 'split' ? 'w-1/2 border-r border-[var(--border)]' : 'w-full'} flex flex-col`}>
            <div className="px-3 py-1.5 text-xs text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--bg-elevated)] flex items-center gap-1.5">
              <FileText size={12} />
              Markdown
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 w-full p-4 font-mono text-sm leading-relaxed bg-[var(--bg-base)] text-[var(--text-primary)] resize-none focus:outline-none"
              spellCheck={false}
              placeholder="Enter markdown content..."
            />
          </div>
        )}

        {/* Preview pane */}
        {(mode === 'view' || mode === 'split') && (
          <div className={`${mode === 'split' ? 'w-1/2' : 'w-full'} flex flex-col overflow-hidden`}>
            {mode === 'split' && (
              <div className="px-3 py-1.5 text-xs text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--bg-elevated)] flex items-center gap-1.5">
                <Eye size={12} />
                Preview
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-6">
              <article className="wiki-prose max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight, rehypeRaw]}
                  skipHtml={false}
                >
                  {processWikiLinks(content)}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        )}
      </div>

      {/* Unsaved changes warning modal */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl border border-[var(--border)] max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-full bg-[var(--warning-faint)]">
                <AlertTriangle size={20} className="text-[var(--warning)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--text-primary)] mb-1">Unsaved changes</h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  You have unsaved changes. Are you sure you want to discard them?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowUnsavedWarning(false)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Keep editing
              </button>
              <button
                onClick={confirmDiscard}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--error)] text-white hover:bg-[var(--error-hover)] transition-colors"
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
