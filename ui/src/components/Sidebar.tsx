import { useState, useCallback } from 'react'
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
} from 'lucide-react'
import { useSearch } from '../hooks/useWiki'
import type { WikiPageMeta, SearchResult, PageType } from '../types'
import { PAGE_TYPE_COLORS } from '../types'

interface SidebarProps {
  vaultId: string
  pages: WikiPageMeta[]
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
          ? 'bg-[#89b4fa]/10 text-[#89b4fa]'
          : 'text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244]/50'
        }
      `}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function PageTree({ vaultId, pages }: { vaultId: string; pages: WikiPageMeta[] }) {
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
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[#6c7086] hover:text-[#cdd6f4] uppercase tracking-wider"
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <FolderOpen size={12} />
                <span>{group}</span>
              </button>
            )}
            {!isCollapsed && (
              <div className={isRoot ? '' : 'ml-3 border-l border-[#313244]/60 pl-2'}>
                {groupPages
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((page) => {
                    const active =
                      location.pathname === `/vault/${vaultId}/wiki/${page.id}` ||
                      location.pathname === `/vault/${vaultId}/wiki/${page.id}/`
                    const color = PAGE_TYPE_COLORS[page.type] || PAGE_TYPE_COLORS.page
                    const icon = TYPE_ICONS[page.type] || '○'
                    return (
                      <button
                        key={page.id}
                        onClick={() => navigate(`/vault/${vaultId}/wiki/${page.id}`)}
                        className={`
                          w-full flex items-center gap-2 px-2 py-1 rounded text-sm text-left
                          transition-colors
                          ${active
                            ? 'bg-[#89b4fa]/10 text-[#cdd6f4]'
                            : 'text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244]/30'
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
  vaultId,
  results,
  query,
  onClose,
}: {
  vaultId: string
  results: SearchResult[]
  query: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  if (!results.length) {
    return (
      <div className="px-3 py-4 text-sm text-[#6c7086] text-center">
        No results for "{query}"
      </div>
    )
  }

  return (
    <div>
      {results.map((r) => (
        <button
          key={r.id}
          onClick={() => {
            navigate(`/vault/${vaultId}/wiki/${r.id}`)
            onClose()
          }}
          className="w-full px-3 py-2.5 text-left hover:bg-[#313244]/50 border-b border-[#313244]/50 last:border-0"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-xs"
              style={{ color: PAGE_TYPE_COLORS[r.type] || PAGE_TYPE_COLORS.page }}
            >
              {TYPE_ICONS[r.type] || '○'}
            </span>
            <span className="text-sm font-medium text-[#cdd6f4] truncate">{r.title}</span>
          </div>
          <p className="text-xs text-[#6c7086] line-clamp-2 pl-4">{r.excerpt}</p>
        </button>
      ))}
    </div>
  )
}

function IngestSection({ vaultId, onUploaded }: { vaultId: string; onUploaded: () => void }) {
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
    setTimeout(() => setSuccess(null), 4000)
  }

  const showError = (msg: string) => {
    setSuccess(null)
    setError(msg)
    setTimeout(() => setError(null), 6000)
  }

  // ── File upload ──────────────────────────────────────────────────────────
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return
      setBusy(true)
      try {
        const form = new FormData()
        for (const f of acceptedFiles) form.append('files', f)
        const res = await fetch(`/api/vaults/${vaultId}/raw/upload`, { method: 'POST', body: form })
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
    [onUploaded]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop })

  // ── Paste text ────────────────────────────────────────────────────────────
  const handlePasteSubmit = useCallback(async () => {
    if (!pasteContent.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/vaults/${vaultId}/raw/text`, {
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
  }, [pasteFilename, pasteContent, onUploaded])

  return (
    <div className="px-2">
      {/* Tab switcher */}
      <div className="flex rounded-md overflow-hidden border border-[#313244] mb-2 text-xs">
        {(['upload', 'paste'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`
              flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors
              ${tab === t
                ? 'bg-[#313244] text-[#cdd6f4]'
                : 'text-[#6c7086] hover:text-[#a6adc8] hover:bg-[#313244]/40'
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
          {...getRootProps()}
          className={`
            p-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center
            ${isDragActive
              ? 'border-[#89b4fa] bg-[#89b4fa]/10 text-[#89b4fa]'
              : 'border-[#313244] text-[#6c7086] hover:border-[#45475a] hover:text-[#a6adc8]'
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
                {isDragActive ? 'Drop files here' : 'Drop files or click to upload'}
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
            className="w-full bg-[#24273a] border border-[#313244] rounded px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder-[#6c7086] outline-none focus:border-[#89b4fa]/50"
          />
          <textarea
            placeholder="Paste markdown, notes, or any text…"
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            rows={5}
            className="w-full bg-[#24273a] border border-[#313244] rounded px-2.5 py-1.5 text-xs text-[#cdd6f4] placeholder-[#6c7086] outline-none focus:border-[#89b4fa]/50 resize-none font-mono"
          />
          <button
            onClick={handlePasteSubmit}
            disabled={busy || !pasteContent.trim()}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 text-xs font-medium hover:bg-[#89b4fa]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Save to raw/
          </button>
        </div>
      )}

      {success && (
        <div className="mt-1.5 p-2 bg-[#a6e3a1]/10 rounded text-xs text-[#a6e3a1]">
          ✓ {success}
        </div>
      )}
      {error && (
        <div className="mt-1.5 p-2 bg-[#f38ba8]/10 rounded text-xs text-[#f38ba8]">
          ✗ {error}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ vaultId, pages }: SidebarProps) {
  const { query, setQuery, results, searching } = useSearch(vaultId)
  const [showSearch, setShowSearch] = useState(false)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#313244]">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={16} className="text-[#89b4fa]" />
          <span className="font-semibold text-[#cdd6f4] text-sm">Personal Wiki</span>
        </div>

        {/* Search */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-[#24273a] border border-[#313244] rounded-md px-2.5 py-1.5">
            {searching ? (
              <Loader2 size={14} className="text-[#6c7086] animate-spin flex-shrink-0" />
            ) : (
              <Search size={14} className="text-[#6c7086] flex-shrink-0" />
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
              className="bg-transparent text-sm text-[#cdd6f4] placeholder-[#6c7086] outline-none w-full"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('')
                  setShowSearch(false)
                }}
                className="text-[#6c7086] hover:text-[#cdd6f4]"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {showSearch && query && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-[#181825] border border-[#313244] rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
              <SearchResults
                vaultId={vaultId}
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

      {/* Nav */}
      <div className="px-2 py-2 border-b border-[#313244] space-y-0.5">
        <NavItem
          label="Graph view"
          to={`/vault/${vaultId}/graph`}
          icon={<GitGraph size={14} />}
        />
        <NavItem
          label="Activity log"
          to={`/vault/${vaultId}/log`}
          icon={<ScrollText size={14} />}
        />
      </div>

      {/* Page tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <PageTree vaultId={vaultId} pages={pages} />
      </div>

      {/* Ingest section */}
      <div className="border-t border-[#313244] py-2">
        <p className="px-4 pb-1.5 text-xs font-semibold text-[#6c7086] uppercase tracking-wider">
          Add Source
        </p>
        <IngestSection vaultId={vaultId} onUploaded={() => {}} />
      </div>
    </div>
  )
}
