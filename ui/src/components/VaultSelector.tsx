import { useState } from 'react'
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
} from 'lucide-react'
import { useVaults, addVault, removeVault } from '../hooks/useWiki'
import { VAULT_DEFAULT_COLORS } from '../types'
import type { VaultConfig } from '../types'

// ─── Add Vault Modal ──────────────────────────────────────────────────────────

function AddVaultModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<'existing' | 'create'>('create')
  const [name, setName] = useState('')
  const [vaultPath, setVaultPath] = useState('')
  const [color, setColor] = useState(VAULT_DEFAULT_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim() || !vaultPath.trim()) {
      setError('Name and path are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addVault(name.trim(), vaultPath.trim(), color, mode === 'create')
      onAdded()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#24273a] border border-[#313244] rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#313244]">
          <h2 className="text-base font-semibold text-[#cdd6f4]">Add a vault</h2>
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
                {m === 'create' ? 'Create new vault' : 'Open existing folder'}
              </button>
            ))}
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-[#6c7086] mb-1.5 font-medium uppercase tracking-wider">
              Vault name
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
              {mode === 'create' ? 'Create at path' : 'Folder path'}
            </label>
            <input
              type="text"
              placeholder="/Users/you/Documents/my-wiki"
              value={vaultPath}
              onChange={(e) => setVaultPath(e.target.value)}
              className="w-full bg-[#1e1e2e] border border-[#313244] rounded-lg px-3 py-2 text-sm text-[#cdd6f4] placeholder-[#6c7086] outline-none focus:border-[#89b4fa]/50 font-mono"
            />
            <p className="text-xs text-[#6c7086] mt-1.5">
              {mode === 'create'
                ? 'The folder will be created with wiki/, raw/inbox/, and starter agent instruction files.'
                : 'Point to an existing folder. It should contain a wiki/ subdirectory.'}
            </p>
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs text-[#6c7086] mb-1.5 font-medium uppercase tracking-wider">
              Color
            </label>
            <div className="flex gap-2">
              {VAULT_DEFAULT_COLORS.map((c) => (
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
            disabled={busy || !name.trim() || !vaultPath.trim()}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 hover:bg-[#89b4fa]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : (mode === 'create' ? <FolderPlus size={14} /> : <FolderOpen size={14} />)}
            {mode === 'create' ? 'Create vault' : 'Add vault'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vault Card ───────────────────────────────────────────────────────────────

function VaultCard({ vault, onOpen, onRemove }: { vault: VaultConfig; onOpen: () => void; onRemove: () => void }) {
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
        title="Remove vault"
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
        <span>Open vault</span>
        <ChevronRight size={14} />
      </div>

      {/* Remove confirm overlay */}
      {confirmRemove && (
        <div
          className="absolute inset-0 bg-[#1e1e2e]/95 rounded-xl flex flex-col items-center justify-center gap-3 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm text-[#cdd6f4] text-center">Remove "{vault.name}" from your vaults?</p>
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

// ─── Main VaultSelector ───────────────────────────────────────────────────────

export default function VaultSelector() {
  const navigate = useNavigate()
  const { vaults, loading, reload } = useVaults()
  const [showModal, setShowModal] = useState(false)

  const handleRemove = async (id: string) => {
    await removeVault(id)
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
            <h1 className="text-base font-semibold text-[#cdd6f4]">Personal Wiki</h1>
            <p className="text-xs text-[#6c7086]">Your knowledge vaults</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-[#cdd6f4]">Vaults</h2>
            <p className="text-sm text-[#6c7086] mt-0.5">
              Each vault is an independent wiki — its own pages, sources, and graph.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 hover:bg-[#89b4fa]/20 text-sm font-medium transition-colors"
          >
            <Plus size={15} />
            Add vault
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[#89b4fa]" size={24} />
          </div>
        ) : vaults.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-[#24273a] border border-[#313244] flex items-center justify-center mx-auto mb-4">
              <BookOpen size={28} className="text-[#6c7086]" />
            </div>
            <h3 className="text-[#cdd6f4] font-medium mb-2">No vaults yet</h3>
            <p className="text-sm text-[#6c7086] mb-6 max-w-xs mx-auto">
              Create a new vault or connect an existing wiki folder to get started.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20 hover:bg-[#89b4fa]/20 text-sm font-medium transition-colors"
            >
              <Plus size={15} />
              Add your first vault
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {vaults.map((vault) => (
              <VaultCard
                key={vault.id}
                vault={vault}
                onOpen={() => navigate(`/vault/${vault.id}`)}
                onRemove={() => handleRemove(vault.id)}
              />
            ))}
            {/* Add vault card */}
            <button
              onClick={() => setShowModal(true)}
              className="bg-[#24273a]/50 border-2 border-dashed border-[#313244] rounded-xl p-5 hover:border-[#45475a] hover:bg-[#24273a] transition-all flex flex-col items-center justify-center gap-3 min-h-48 text-[#6c7086] hover:text-[#a6adc8]"
            >
              <FolderPlus size={24} />
              <span className="text-sm font-medium">Add vault</span>
            </button>
          </div>
        )}
      </main>

      {showModal && (
        <AddVaultModal onClose={() => setShowModal(false)} onAdded={reload} />
      )}
    </div>
  )
}
