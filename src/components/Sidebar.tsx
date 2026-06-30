import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import {
  Search,
  BookOpen,
  GitGraph,
  ScrollText,
  ChevronRight,
  ChevronDown,
  Upload,
  Loader2,
  X,
  FolderOpen,
  ClipboardPaste,
  Send,
  FileText,
  ClipboardCopy,
} from 'lucide-react'
import { useSearch, useRawFiles, useWikis } from '../hooks/useWiki'
import type { WikiPageMeta, SearchResult, PageType, RawFile } from '../types'
import { PAGE_TYPE_COLORS } from '../types'
import IDELaunchModal from './IDELaunchModal'

interface SidebarProps {
  wikiId: string
  pages: WikiPageMeta[]
  mode?: 'wiki' | 'folder'
}

const TYPE_ICONS: Record<PageType | string, string> = {
  overview: '◎',
  entity: '◈',
  concept: '◇',
  source: '◉',
  comparison: '⊞',
  timeline: '⊟',
  question: '?',
  analysis: '◆',
  page: '○',
}

function NavItem({ label, to, icon }: { label: string; to: string; icon: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const active = location.pathname === to || location.pathname === to + '/'
  return (
    <button
      onClick={() => navigate(to)}
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left
        transition-colors
        ${active
          ? 'bg-[var(--accent-faint)] text-[var(--accent)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/50'
        }
      `}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function PageTree({ wikiId, pages }: { wikiId: string; pages: WikiPageMeta[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Group pages by top-level section (prefix before /)
  const groups: Record<string, WikiPageMeta[]> = {}
  for (const p of pages) {
    const parts = p.id.split('/')
    const group = parts.length > 1 ? parts[0] : '_root'
    if (!groups[group]) groups[group] = []
    groups[group].push(p)
  }

  const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
    /* v8 ignore next */
    if (a === '_root') return -1
    if (b === '_root') return 1
    return a.localeCompare(b)
  })

  return (
    <div className="space-y-0.5">
      {sortedGroups.map(([group, groupPages]) => {
        const isRoot = group === '_root'
        const isCollapsed = collapsed[group]

        return (
          <div key={group}>
            {!isRoot && (
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] uppercase tracking-wider"
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <FolderOpen size={12} />
                <span>{group}</span>
              </button>
            )}
            {!isCollapsed && (
              <div className={isRoot ? '' : 'ml-3 border-l border-[var(--border)]/60 pl-2'}>
                {groupPages
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((page) => {
                    const active =
                      location.pathname === `/wiki/${wikiId}/page/${page.id}` ||
                      location.pathname === `/wiki/${wikiId}/page/${page.id}/`
                    /* v8 ignore next */
                    const color = PAGE_TYPE_COLORS[page.type] || PAGE_TYPE_COLORS.page
                    /* v8 ignore next */
                    const icon = TYPE_ICONS[page.type] || '○'
                    return (
                      <button
                        key={page.id}
                        onClick={() => navigate(`/wiki/${wikiId}/page/${page.id}`)}
                        className={`
                          w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left
                          transition-colors
                          ${active
                            ? 'bg-[var(--accent-faint)] text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/30'
                          }
                        `}
                        title={page.title}
                      >
                        <span className="flex-shrink-0 text-xs" style={{ color }}>
                          {icon}
                        </span>
                        <span className="truncate">
                          {isRoot ? page.title : page.id.split('/').pop()}
                        </span>
                      </button>
                    )
                  })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SearchResults({
  wikiId,
  results,
  query,
  onClose,
}: {
  wikiId: string
  results: SearchResult[]
  query: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  if (!results.length) {
    return (
      <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
        No results for "{query}"
      </div>
    )
  }

  return (
    <div>
      {results.map((r) => {
        /* v8 ignore next */
        const rColor = PAGE_TYPE_COLORS[r.type] || PAGE_TYPE_COLORS.page
        /* v8 ignore next */
        const rIcon = TYPE_ICONS[r.type] || '○'
        return (
          <button
            key={r.id}
            onClick={() => {
              navigate(`/wiki/${wikiId}/page/${r.id}`)
              onClose()
            }}
            className="w-full px-3 py-2.5 text-left hover:bg-[var(--bg-elevated)]/50 border-b border-[var(--border-subtle)] last:border-0"
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="text-xs"
                style={{ color: rColor }}
              >
                {rIcon}
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)] truncate">{r.title}</span>
            </div>
            <p className="text-xs text-[var(--text-muted)] line-clamp-2 pl-4">{r.excerpt}</p>
          </button>
        )
      })}
    </div>
  )
}

import { snapshotDrop, resolveDropSnapshot } from '../utils/dragDrop'

function IngestSection({ wikiId, inboxExists, onUploaded }: { wikiId: string; inboxExists: boolean | null; onUploaded: () => void }) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // paste-text state
  const [pasteFilename, setPasteFilename] = useState('')
  const [pasteContent, setPasteContent] = useState('')

  const showSuccess = (msg: string) => {
    setError(null)
    setSuccess(msg)
    /* v8 ignore next */
    setTimeout(() => setSuccess(null), 4000)
  }

  const showError = (msg: string) => {
    setSuccess(null)
    setError(msg)
    /* v8 ignore next */
    setTimeout(() => setError(null), 6000)
  }

  // ── File upload ──────────────────────────────────────────────────────────
  const handleFiles = useCallback(
    async (files: File[]) => {
      /* v8 ignore next */
      if (!files.length) return
      setBusy(true)
      try {
        const form = new FormData()
        for (const f of files) form.append('files', f)
        const res = await fetch(`/api/wikis/${wikiId}/raw/upload`, { method: 'POST', body: form })
        if (!res.ok) throw new Error(`Server error: ${res.status}`)
        const data = (await res.json()) as { uploaded: Array<{ name: string }> }
        showSuccess(`Added: ${data.uploaded.map((f) => f.name).join(', ')}`)
        onUploaded()
      } catch (e) {
        showError(String(e))
      } finally {
        setBusy(false)
      }
    },
    [wikiId, onUploaded]
  )

  // react-dropzone is kept only for click-to-browse; native events handle the
  // actual drag so Outlook (which omits 'Files' from dataTransfer.types) works.
  const { getInputProps, open: openFilePicker } = useDropzone({
    onDrop: handleFiles,
    noDrag: true,
    noClick: true,
  })

  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [nativeDragActive, setNativeDragActive] = useState(false)
  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  useEffect(() => {
    const el = dropZoneRef.current
    /* v8 ignore next */
    if (!el) return

    const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setNativeDragActive(true) }
    const onDragEnter = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setNativeDragActive(true) }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      /* v8 ignore next */
      if (!el.contains(e.relatedTarget as Node | null)) setNativeDragActive(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setNativeDragActive(false)
      if (!e.dataTransfer) return
      // Snapshot synchronously (DataTransfer clears after handler returns),
      // then resolve asynchronously and upload.
      const snap = snapshotDrop(e.dataTransfer)
      /* v8 ignore next */
      resolveDropSnapshot(snap).then((files) => { if (files.length) handleFilesRef.current(files) })
    }

    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragenter', onDragEnter)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragenter', onDragEnter)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [])

  // ── Paste text ────────────────────────────────────────────────────────────
  const handlePasteSubmit = useCallback(async () => {
    /* v8 ignore next */
    if (!pasteContent.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/wikis/${wikiId}/raw/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: pasteFilename, content: pasteContent }),
      })
      const data = (await res.json()) as { name?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Server error: ${res.status}`)
      showSuccess(`Saved: ${data.name}`)
      setPasteFilename('')
      setPasteContent('')
      onUploaded()
    } catch (e) {
      showError(String(e))
    } finally {
      setBusy(false)
    }
  }, [wikiId, pasteFilename, pasteContent, onUploaded])

  // If no inbox folder, show error message instead of upload UI
  if (inboxExists === false) {
    return (
      <div className="px-2">
        <div className="p-3 rounded-lg border border-[var(--error-border)] bg-[var(--error-faint)] text-xs text-[var(--error)] space-y-1">
          <p className="font-medium">No raw/inbox/ folder</p>
          <p className="text-[var(--error)]/70">Run <code className="bg-[var(--bg-base)] px-1 rounded">/create-wiki</code> in your IDE to set up the folder structure.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2">
      {/* Tab switcher */}
      <div className="flex rounded-md overflow-hidden border border-[var(--border)] mb-2 text-xs">
        {(['upload', 'paste'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`
              flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors
              ${tab === t
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/40'
              }
            `}
          >
            {t === 'upload' ? <Upload size={11} /> : <ClipboardPaste size={11} />}
            {t === 'upload' ? 'Upload' : 'Paste text'}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div
          ref={dropZoneRef}
          onClick={openFilePicker}
          className={`
            p-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center
            ${nativeDragActive
              ? 'border-[var(--accent)] bg-[var(--accent-faint)] text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]'
            }
          `}
        >
          <input {...getInputProps()} />
          {busy ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 size={13} className="animate-spin" />
              <span className="text-xs">Uploading…</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Upload size={13} />
              <span className="text-xs">
                {nativeDragActive ? 'Drop files here' : 'Drop files or click to upload'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <input
            type="text"
            placeholder="Filename (optional, .md auto-added)"
            value={pasteFilename}
            onChange={(e) => setPasteFilename(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)]"
          />
          <textarea
            placeholder="Paste markdown, notes, or any text…"
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            rows={5}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)] resize-none font-mono"
          />
          <button
            onClick={handlePasteSubmit}
            disabled={busy || !pasteContent.trim()}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] text-xs font-medium hover:bg-[var(--accent-moderate)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Save to raw/
          </button>
        </div>
      )}

      {success && (
        <div className="mt-1.5 p-2 bg-[var(--success-faint)] rounded text-xs text-[var(--success)]">
          ✓ {success}
        </div>
      )}
      {error && (
        <div className="mt-1.5 p-2 bg-[var(--error-faint)] rounded text-xs text-[var(--error)]">
          ✗ {error}
        </div>
      )}
    </div>
  )
}

function InboxSection({ wikiId: _wikiId, wikiPath, files, loading, reload }: { wikiId: string; wikiPath: string; files: RawFile[]; loading: boolean; reload: () => void }) {
  const [ingestTarget, setIngestTarget] = useState<RawFile | null>(null)

  const inboxFiles: RawFile[] = files.filter((f) => f.path.startsWith('inbox/'))

  if (loading || inboxFiles.length === 0) return null

  return (
    <>
      {/* IDE launch modal — rendered at root level so it overlays the sidebar */}
      {ingestTarget && (
        <IDELaunchModal
          key={ingestTarget.name}
          title={`Ingest ${ingestTarget.name}`}
          wikiPath={wikiPath}
          fixedCommand={`ADD raw/inbox/${ingestTarget.name}`}
          onClose={() => setIngestTarget(null)}
        />
      )}

      <div className="border-t border-[var(--border)] py-2">
        <div className="flex items-center justify-between px-4 pb-1.5">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Inbox ({inboxFiles.length})
          </p>
          <button
            onClick={reload}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Refresh inbox"
          >
            <ScrollText size={11} />
          </button>
        </div>
        <div className="px-2 space-y-0.5">
          {inboxFiles.map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-elevated)]/30 group"
            >
              <FileText size={11} className="text-[var(--text-muted)] flex-shrink-0" />
              <span className="text-xs text-[var(--text-secondary)] truncate flex-1" title={file.name}>
                {file.name}
              </span>
              <button
                onClick={() => setIngestTarget(file)}
                title="Open in editor and copy ingest command"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-faint)] opacity-0 group-hover:opacity-100"
              >
                <ClipboardCopy size={11} />
                <span>Ingest</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function Sidebar({ wikiId, pages, mode = 'wiki' }: SidebarProps) {
  const { query, setQuery, results, searching } = useSearch(wikiId)
  const { files: rawFiles, inboxExists, loading: rawLoading, reload: reloadRaw } = useRawFiles(wikiId)
  const { wikis } = useWikis()
  const wikiPath = wikis.find((w) => w.id === wikiId)?.path ?? ''
  const [showSearch, setShowSearch] = useState(false)

  const isFolder = mode === 'folder'

  return (
    <div className="wiki-sidebar flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={16} className="text-[var(--accent)]" />
          <span className="font-semibold text-[var(--text-primary)] text-sm">
            {isFolder ? 'Folder' : 'Wiki'}
          </span>
          {isFolder && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] uppercase tracking-wider">
              read-only
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5">
            {searching ? (
              <Loader2 size={14} className="text-[var(--text-muted)] animate-spin flex-shrink-0" />
            ) : (
              <Search size={14} className="text-[var(--text-muted)] flex-shrink-0" />
            )}
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setShowSearch(true)
              }}
              onFocus={() => setShowSearch(true)}
              className="bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none w-full"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('')
                  setShowSearch(false)
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {showSearch && query && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-[var(--bg-mantle)] border border-[var(--border)] rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
              <SearchResults
                wikiId={wikiId}
                results={results}
                query={query}
                onClose={() => {
                  setQuery('')
                  setShowSearch(false)
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Nav — wiki-only views */}
      {!isFolder && (
        <div className="px-2 py-2 border-b border-[var(--border)] space-y-0.5">
          <NavItem
            label="Graph view"
            to={`/wiki/${wikiId}/graph`}
            icon={<GitGraph size={14} />}
          />
          <NavItem
            label="Activity log"
            to={`/wiki/${wikiId}/log`}
            icon={<ScrollText size={14} />}
          />
        </div>
      )}

      {/* Page / file tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <PageTree wikiId={wikiId} pages={pages} />
      </div>

      {/* Inbox + Add Source — wiki-only */}
      {!isFolder && (
        <>
          <InboxSection wikiId={wikiId} wikiPath={wikiPath} files={rawFiles} loading={rawLoading} reload={reloadRaw} />
          <div className="border-t border-[var(--border)] py-2">
            <p className="px-4 pb-1.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Add Source
            </p>
            <IngestSection wikiId={wikiId} inboxExists={inboxExists} onUploaded={reloadRaw} />
          </div>
        </>
      )}
    </div>
  )
}
