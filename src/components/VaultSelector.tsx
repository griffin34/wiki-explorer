import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Plus,
  FolderOpen,
  FolderPlus,
  Loader2,
  Trash2,
  X,
  ChevronRight,
  FileText,
  Clock,
  Database,
  FolderSearch,
  CheckCircle2,
  MonitorPlay,
  Moon,
} from 'lucide-react'
import SirenIcon from './SirenIcon'
import { useWikis, addWiki, removeWiki, pickFolder, detectIDEs, openInIDE } from '../hooks/useWiki'
import type { IDEInfo } from '../hooks/useWiki'
import { WIKI_DEFAULT_COLORS } from '../types'
import type { WikiConfig } from '../types'
import { useTheme } from '../ThemeContext'
import { IDE_CREATE_COMMANDS } from './IDELaunchModal'

// ─── IDE Picker (shown after wiki creation) ───────────────────────────────────

function IDEPicker({ wikiPath, onDone }: { wikiPath: string; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Open this wiki folder in your editor, then run the setup command in the chat window:
      </p>
      <IDELaunchModalInline wikiPath={wikiPath} />
      <button
        onClick={onDone}
        className="w-full py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors"
      >
        Done
      </button>
    </div>
  )
}

/** Inline (non-overlay) version of the IDE launcher used inside the AddWikiModal step. */
function IDELaunchModalInline({ wikiPath }: { wikiPath: string }) {
  const [ides, setIDEs] = useState<IDEInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState<string | null>(null)
  const [launched, setLaunched] = useState<string | null>(null)
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    detectIDEs().then((detected) => { setIDEs(detected); setLoading(false) })
  }, [])

  const handleOpen = async (ide: IDEInfo) => {
    setLaunching(ide.id)
    setError(null)
    try {
      await openInIDE(ide.id, wikiPath)
      setLaunched(ide.id)
      const command = IDE_CREATE_COMMANDS[ide.id] ?? '/create-wiki'
      await navigator.clipboard.writeText(command)
      setCopiedCommand(command)
    } catch (e) {
      setError(String(e))
    } finally {
      setLaunching(null)
    }
  }

  const IDE_COLORS: Record<string, string> = {
    cursor: '#89b4fa', vscode: '#4fc3f7', windsurf: '#a6e3a1',
    intellij: '#f38ba8', webstorm: '#89dceb', pycharm: '#cba6f7',
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Detecting installed editors…</span>
        </div>
      ) : ides.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No supported editors detected. Open <code className="text-[var(--text-primary)] bg-[var(--bg-base)] px-1 rounded">{wikiPath}</code> manually.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {ides.map((ide) => {
            const color = IDE_COLORS[ide.id] ?? 'var(--text-muted)'
            const isLaunching = launching === ide.id
            const isLaunched = launched === ide.id
            return (
              <button
                key={ide.id}
                onClick={() => handleOpen(ide)}
                disabled={!!launching}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all disabled:opacity-60"
                style={{
                  borderColor: isLaunched ? `${color}60` : 'var(--border)',
                  backgroundColor: isLaunched ? `${color}15` : 'var(--bg-base)',
                }}
              >
                <MonitorPlay size={15} style={{ color }} className="flex-shrink-0" />
                <span className="text-sm font-medium" style={{ color: isLaunched ? color : 'var(--text-primary)' }}>
                  {isLaunching ? 'Opening…' : isLaunched ? 'Opened!' : ide.name}
                </span>
                {isLaunching && <Loader2 size={12} className="animate-spin ml-auto" style={{ color }} />}
                {isLaunched && <CheckCircle2 size={12} className="ml-auto" style={{ color }} />}
              </button>
            )
          })}
        </div>
      )}
      {copiedCommand && (
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--accent-faint)] border border-[var(--accent-border)]">
          <Check size={14} className="text-[var(--accent)] mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-secondary)] leading-snug">Copied — paste into the editor chat:</p>
            <code className="text-xs font-mono font-semibold text-[var(--accent)] mt-0.5 block">{copiedCommand}</code>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-[var(--error)]">{error}</p>}
    </div>
  )
}

// ─── Add Wiki Modal ──────────────────────────────────────────────────────────

function AddWikiModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<'existing' | 'create'>('create')
  const [name, setName] = useState('')
  const [wikiPath, setVaultPath] = useState('')
  const [color, setColor] = useState(WIKI_DEFAULT_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdPath, setCreatedPath] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState<string | null>(null)

  const handleBrowse = async () => {
    setPicking(true)
    try {
      const chosen = await pickFolder()
      if (chosen) setVaultPath(chosen)
    } catch (e) {
      setError(String(e))
    } finally {
      setPicking(false)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim() || !wikiPath.trim()) {
      setError('Name and path are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const wiki = await addWiki(name.trim(), wikiPath.trim(), color, mode === 'create')
      onAdded()
      setCreatedPath(wiki.path)
      setCreatedName(wiki.name)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // ── Success state: show IDE picker ──────────────────────────────────────────
  if (createdPath && createdName) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md mx-4">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[var(--success)]" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Wiki created</h2>
            </div>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={18} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-3">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{createdName}</p>
              <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5 break-all">{createdPath}</p>
            </div>
            <IDEPicker wikiPath={createdPath} onDone={onClose} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Add a wiki</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
            {(['create', 'existing'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm transition-colors
                  ${mode === m ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              >
                {m === 'create' ? <FolderPlus size={14} /> : <FolderOpen size={14} />}
                {m === 'create' ? 'Create new wiki' : 'Open existing folder'}
              </button>
            ))}
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
              Wiki name
            </label>
            <input
              type="text"
              placeholder="My Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)]"
            />
          </div>

          {/* Path */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
              {mode === 'create' ? 'Parent folder' : 'Folder path'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="/Users/you/Documents"
                value={wikiPath}
                onChange={(e) => setVaultPath(e.target.value)}
                className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)] font-mono"
              />
              <button
                type="button"
                onClick={handleBrowse}
                disabled={picking}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] bg-[var(--bg-base)] disabled:opacity-40 transition-colors flex-shrink-0"
                title="Browse for folder"
              >
                {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderSearch size={14} />}
                Browse
              </button>
            </div>
            {mode === 'create' && wikiPath.trim() && name.trim() ? (
              <p className="text-xs text-[var(--text-muted)] mt-1.5 font-mono">
                Will create: <span className="text-[var(--success)]">{wikiPath.trim()}/{name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}</span>
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-1.5">
                {mode === 'create'
                  ? 'The wiki folder will be created inside this parent directory.'
                  : 'Point to an existing wiki folder. It should contain a wiki/ subdirectory.'}
              </p>
            )}
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
              Color
            </label>
            <div className="flex gap-2">
              {WIKI_DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white/30' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-[var(--error-faint)] border border-[var(--error-border)] rounded-lg text-sm text-[var(--error)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !name.trim() || !wikiPath.trim()}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-moderate)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : (mode === 'create' ? <FolderPlus size={14} /> : <FolderOpen size={14} />)}
            {mode === 'create' ? 'Create wiki' : 'Add wiki'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Wiki Card ───────────────────────────────────────────────────────────────

function WikiCard({ vault, onOpen, onRemove }: { vault: WikiConfig; onOpen: () => void; onRemove: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <div
      className="group relative bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--border-strong)] transition-all cursor-pointer flex flex-col gap-4"
      onClick={onOpen}
      style={{ borderTopColor: vault.color, borderTopWidth: '3px' }}
    >
      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); setConfirmRemove(true) }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-[var(--error)] transition-all"
        title="Remove wiki"
      >
        <Trash2 size={14} />
      </button>

      {/* Icon + name */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${vault.color}20` }}
        >
          <BookOpen size={18} style={{ color: vault.color }} />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-[var(--text-primary)] text-base truncate">{vault.name}</h3>
          <p className="text-xs text-[var(--text-muted)] truncate font-mono mt-0.5">{vault.path}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <FileText size={11} />
          {vault.stats?.pageCount ?? 0} pages
        </span>
        <span className="flex items-center gap-1.5">
          <Database size={11} />
          {vault.stats?.sourceCount ?? 0} sources
        </span>
        {vault.stats?.lastActivity && (
          <span className="flex items-center gap-1.5">
            <Clock size={11} />
            {vault.stats.lastActivity}
          </span>
        )}
      </div>

      {/* Open button */}
      <div
        className="flex items-center justify-between pt-3 border-t border-[var(--border)] text-xs font-medium"
        style={{ color: vault.color }}
      >
        <span>Open wiki</span>
        <ChevronRight size={14} />
      </div>

      {/* Remove confirm overlay */}
      {confirmRemove && (
        <div
          className="absolute inset-0 bg-[var(--bg-base)]/95 rounded-xl flex flex-col items-center justify-center gap-3 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-[var(--text-primary)] text-center">Remove "{vault.name}" from your wikis?</p>
          <p className="text-xs text-[var(--text-muted)] text-center">Files on disk are not deleted.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmRemove(false)}
              className="px-3 py-1.5 rounded text-xs border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={onRemove}
              className="px-3 py-1.5 rounded text-xs bg-[var(--error-faint)] text-[var(--error)] border border-[var(--error-border)] hover:opacity-80"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main WikiSelector ───────────────────────────────────────────────────────

export default function WikiSelector() {
  const navigate = useNavigate()
  const { wikis, loading, reload } = useWikis()
  const [showModal, setShowModal] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const handleRemove = async (id: string) => {
    await removeWiki(id)
    reload()
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col">
      {/* Header */}
      <header className="wiki-header border-b border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-8 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-faint)] flex items-center justify-center">
            <BookOpen size={16} className="text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)]">Wiki Explorer</h1>
            <p className="text-xs text-[var(--text-muted)]">Your wikis</p>
          </div>
          <button
            onClick={toggleTheme}
            className="ml-auto p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={theme === 'brand' ? 'Switch to dark theme' : 'Switch to brand theme'}
          >
            {theme === 'brand' ? <Moon size={15} /> : <SirenIcon size={15} />}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">Wikis</h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              Each wiki is independent — its own pages, sources, and graph.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-moderate)] text-sm font-medium transition-colors"
          >
            <Plus size={15} />
            Add wiki
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[var(--accent)]" size={24} />
          </div>
        ) : wikis.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4">
              <BookOpen size={28} className="text-[var(--text-muted)]" />
            </div>
            <h3 className="text-[var(--text-primary)] font-medium mb-2">No wikis yet</h3>
            <p className="text-sm text-[var(--text-muted)] mb-6 max-w-xs mx-auto">
              Create a new wiki or connect an existing folder to get started.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-moderate)] text-sm font-medium transition-colors"
            >
              <Plus size={15} />
              Add your first wiki
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {wikis.map((wiki) => (
              <WikiCard
                key={wiki.id}
                vault={wiki}
                onOpen={() => navigate(`/wiki/${wiki.id}`)}
                onRemove={() => handleRemove(wiki.id)}
              />
            ))}
            {/* Add wiki card */}
            <button
              onClick={() => setShowModal(true)}
              className="bg-[var(--surface-half)] border-2 border-dashed border-[var(--border)] rounded-xl p-5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface)] transition-all flex flex-col items-center justify-center gap-3 min-h-48 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <FolderPlus size={24} />
              <span className="text-sm font-medium">Add wiki</span>
            </button>
          </div>
        )}
      </main>

      {showModal && (
        <AddWikiModal onClose={() => setShowModal(false)} onAdded={reload} />
      )}
    </div>
  )
}
