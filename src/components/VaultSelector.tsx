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
} from 'lucide-react'
import { useWikis, addWiki, removeWiki, pickFolder, detectIDEs, openInIDE } from '../hooks/useWiki'
import type { IDEInfo } from '../hooks/useWiki'
import { WIKI_DEFAULT_COLORS } from '../types'
import type { WikiConfig } from '../types'

// ─── IDE Picker (shown after wiki creation) ───────────────────────────────────

function IDEPicker({ wikiPath, onDone }: { wikiPath: string; onDone: () => void }) {
  const [ides, setIDEs] = useState<IDEInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState<string | null>(null)
  const [launched, setLaunched] = useState<string | null>(null)
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
    } catch (e) {
      setError(String(e))
    } finally {
      setLaunching(null)
    }
  }

  const IDE_COLORS: Record<string, string> = {
    cursor: '#89b4fa',
    vscode: '#4fc3f7',
    windsurf: '#a6e3a1',
    intellij: '#f38ba8',
    webstorm: '#89dceb',
    pycharm: '#cba6f7',
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#6c7086]">Open this wiki folder in your editor to start working with the LLM:</p>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6c7086]">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Detecting installed editors…</span>
        </div>
      ) : ides.length === 0 ? (
        <p className="text-sm text-[#6c7086]">No supported editors detected. Open <code className="text-[#cdd6f4] bg-[#1e1e2e] px-1 rounded">{wikiPath}</code> manually.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {ides.map((ide) => {
            const color = IDE_COLORS[ide.id] ?? '#6c7086'
            const isLaunching = launching === ide.id
            const isLaunched = launched === ide.id
            return (
              <button
                key={ide.id}
                onClick={() => handleOpen(ide)}
                disabled={!!launching}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all disabled:opacity-60"
                style={{
                  borderColor: isLaunched ? `${color}60` : '#313244',
                  backgroundColor: isLaunched ? `${color}15` : '#1e1e2e',
                }}
              >
                <MonitorPlay size={15} style={{ color }} className="flex-shrink-0" />
                <span className="text-sm font-medium" style={{ color: isLaunched ? color : '#cdd6f4' }}>
                  {isLaunching ? 'Opening…' : isLaunched ? 'Opened!' : ide.name}
                </span>
                {isLaunching && <Loader2 size={12} className="animate-spin ml-auto" style={{ color }} />}
                {isLaunched && <CheckCircle2 size={12} className="ml-auto" style={{ color }} />}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <p className="text-xs text-[#f38ba8]">{error}</p>
      )}

      <button
        onClick={onDone}
        className="w-full py-2 rounded-lg text-sm text-[#6c7086] hover:text-[#cdd6f4] border border-[#313244] hover:border-[#45475a] transition-colors"
      >
        Done
      </button>
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
        <div className="bg-[#24273a] border border-[#313244] rounded-xl shadow-2xl w-full max-w-md mx-4">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#313244]">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#a6e3a1]" />
              <h2 className="text-base font-semibold text-[#cdd6f4]">Wiki created</h2>
            </div>
            <button onClick={onClose} className="text-[#6c7086] hover:text-[#cdd6f4]">
              <X size={18} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-3">
            <div>
              <p className="text-sm font-medium text-[#cdd6f4]">{createdName}</p>
              <p className="text-xs text-[#6c7086] font-mono mt-0.5 break-all">{createdPath}</p>
            </div>
            <IDEPicker wikiPath={createdPath} onDone={onClose} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#24273a] border border-[#313244] rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#313244]">
          <h2 className="text-base font-semibold text-[#cdd6f4]">Add a wiki</h2>
          <button onClick={onClose} className="text-[#6c7086] hover:text-[#cdd6f4]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[#313244]">
            {(['create', 'existing'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm transition-colors
                  ${mode === m ? 'bg-[#313244] text-[#cdd6f4]' : 'text-[#6c7086] hover:text-[#a6adc8]'}`}
              >
                {m === 'create' ? <FolderPlus size={14} /> : <FolderOpen size={14} />}
                {m === 'create' ? 'Create new wiki' : 'Open existing folder'}
              </button>
            ))}
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-[#6c7086] mb-1.5 font-medium uppercase tracking-wider">
              Wiki name
            </label>
            <input
              type="text"
              placeholder="My Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#1e1e2e] border border-[#313244] rounded-lg px-3 py-2 text-sm text-[#cdd6f4] placeholder-[#6c7086] outline-none focus:border-[#89b4fa]/50"
            />
          </div>

          {/* Path */}
          <div>
            <label className="block text-xs text-[#6c7086] mb-1.5 font-medium uppercase tracking-wider">
              {mode === 'create' ? 'Parent folder' : 'Folder path'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="/Users/you/Documents"
                value={wikiPath}
                onChange={(e) => setVaultPath(e.target.value)}
                className="flex-1 bg-[#1e1e2e] border border-[#313244] rounded-lg px-3 py-2 text-sm text-[#cdd6f4] placeholder-[#6c7086] outline-none focus:border-[#89b4fa]/50 font-mono"
              />
              <button
                type="button"
                onClick={handleBrowse}
                disabled={picking}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#313244] text-sm text-[#6c7086] hover:text-[#cdd6f4] hover:border-[#45475a] bg-[#1e1e2e] disabled:opacity-40 transition-colors flex-shrink-0"
                title="Browse for folder"
              >
                {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderSearch size={14} />}
                Browse
              </button>
            </div>
            {mode === 'create' && wikiPath.trim() && name.trim() ? (
              <p className="text-xs text-[#6c7086] mt-1.5 font-mono">
                Will create: <span className="text-[#a6e3a1]">{wikiPath.trim()}/{name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}</span>
              </p>
            ) : (
              <p className="text-xs text-[#6c7086] mt-1.5">
                {mode === 'create'
                  ? 'The wiki folder will be created inside this parent directory.'
                  : 'Point to an existing wiki folder. It should contain a wiki/ subdirectory.'}
              </p>
            )}
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs text-[#6c7086] mb-1.5 font-medium uppercase tracking-wider">
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
            <div className="p-3 bg-[#f38ba8]/10 border border-[#f38ba8]/20 rounded-lg text-sm text-[#f38ba8]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-[#313244]">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm text-[#6c7086] hover:text-[#cdd6f4] border border-[#313244] hover:border-[#45475a] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !name.trim() || !wikiPath.trim()}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 hover:bg-[#89b4fa]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
      className="group relative bg-[#24273a] border border-[#313244] rounded-xl p-5 hover:border-[#45475a] transition-all cursor-pointer flex flex-col gap-4"
      onClick={onOpen}
      style={{ borderTopColor: vault.color, borderTopWidth: '3px' }}
    >
      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); setConfirmRemove(true) }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded text-[#6c7086] hover:text-[#f38ba8] transition-all"
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
          <h3 className="font-semibold text-[#cdd6f4] text-base truncate">{vault.name}</h3>
          <p className="text-xs text-[#6c7086] truncate font-mono mt-0.5">{vault.path}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-[#6c7086]">
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
        className="flex items-center justify-between pt-3 border-t border-[#313244] text-xs font-medium"
        style={{ color: vault.color }}
      >
        <span>Open wiki</span>
        <ChevronRight size={14} />
      </div>

      {/* Remove confirm overlay */}
      {confirmRemove && (
        <div
          className="absolute inset-0 bg-[#1e1e2e]/95 rounded-xl flex flex-col items-center justify-center gap-3 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-[#cdd6f4] text-center">Remove "{vault.name}" from your wikis?</p>
          <p className="text-xs text-[#6c7086] text-center">Files on disk are not deleted.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmRemove(false)}
              className="px-3 py-1.5 rounded text-xs border border-[#313244] text-[#6c7086] hover:text-[#cdd6f4]"
            >
              Cancel
            </button>
            <button
              onClick={onRemove}
              className="px-3 py-1.5 rounded text-xs bg-[#f38ba8]/10 text-[#f38ba8] border border-[#f38ba8]/20 hover:bg-[#f38ba8]/20"
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

  const handleRemove = async (id: string) => {
    await removeWiki(id)
    reload()
  }

  return (
    <div className="min-h-screen bg-[#1e1e2e] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#313244] bg-[#181825]">
        <div className="max-w-5xl mx-auto px-8 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#89b4fa]/10 flex items-center justify-center">
            <BookOpen size={16} className="text-[#89b4fa]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#cdd6f4]">Wiki Explorer</h1>
            <p className="text-xs text-[#6c7086]">Your wikis</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-[#cdd6f4]">Wikis</h2>
            <p className="text-sm text-[#6c7086] mt-0.5">
              Each wiki is independent — its own pages, sources, and graph.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 hover:bg-[#89b4fa]/20 text-sm font-medium transition-colors"
          >
            <Plus size={15} />
            Add wiki
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[#89b4fa]" size={24} />
          </div>
        ) : wikis.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[#24273a] border border-[#313244] flex items-center justify-center mx-auto mb-4">
              <BookOpen size={28} className="text-[#6c7086]" />
            </div>
            <h3 className="text-[#cdd6f4] font-medium mb-2">No wikis yet</h3>
            <p className="text-sm text-[#6c7086] mb-6 max-w-xs mx-auto">
              Create a new wiki or connect an existing folder to get started.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 hover:bg-[#89b4fa]/20 text-sm font-medium transition-colors"
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
              className="bg-[#24273a]/50 border-2 border-dashed border-[#313244] rounded-xl p-5 hover:border-[#45475a] hover:bg-[#24273a] transition-all flex flex-col items-center justify-center gap-3 min-h-48 text-[#6c7086] hover:text-[#a6adc8]"
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
