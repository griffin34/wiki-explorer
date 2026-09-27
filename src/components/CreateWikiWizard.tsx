import { useState } from 'react'
import {
  X,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  FolderPlus,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Plus,
} from 'lucide-react'
import { WIKI_DEFAULT_COLORS } from '../types'

interface ProposedFolder {
  name: string
  description: string
}

interface CreateWikiWizardProps {
  parentPath: string
  onClose: () => void
  onCreated: (wikiId: string) => void
}

type Step = 'configure' | 'structure' | 'creating' | 'complete'

export default function CreateWikiWizard({ parentPath, onClose, onCreated }: CreateWikiWizardProps) {
  const [step, setStep] = useState<Step>('configure')
  const [error, setError] = useState<string | null>(null)

  // Step 1: Configuration
  const [wikiName, setWikiName] = useState('')
  const [topics, setTopics] = useState<string[]>([''])
  const [sourceTypes, setSourceTypes] = useState<string[]>([''])
  const [color, setColor] = useState(WIKI_DEFAULT_COLORS[0])

  // Step 2: Structure
  const [proposing, setProposing] = useState(false)
  const [summary, setSummary] = useState('')
  const [folders, setFolders] = useState<ProposedFolder[]>([])

  // Step 3-4: Creating/Complete
  const [creating, setCreating] = useState(false)
  const [, setCreatedWikiId] = useState<string | null>(null)
  const [createdPath, setCreatedPath] = useState<string | null>(null)
  const [filesCreated, setFilesCreated] = useState<string[]>([])

  // Helper to filter empty strings from arrays
  const filterEmpty = (arr: string[]) => arr.filter(s => s.trim())

  // Step 1 → Step 2: Propose structure
  const handleProposeStructure = async () => {
    const cleanTopics = filterEmpty(topics)
    const cleanSources = filterEmpty(sourceTypes)

    if (!wikiName.trim()) {
      setError('Please enter a wiki name')
      return
    }
    if (cleanTopics.length === 0) {
      setError('Please enter at least one topic')
      return
    }
    if (cleanSources.length === 0) {
      setError('Please enter at least one source type')
      return
    }

    setError(null)
    setProposing(true)

    try {
      const res = await fetch('http://localhost:8000/wiki/propose-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wiki_name: wikiName.trim(),
          topics: cleanTopics,
          source_types: cleanSources,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Server error: ${res.status}`)
      }

      const data = await res.json()
      setSummary(data.summary)
      setFolders(data.folders)
      setStep('structure')
    } catch (e) {
      setError(String(e))
    } finally {
      setProposing(false)
    }
  }

  // Step 2 → Step 3/4: Create wiki
  const handleCreateWiki = async () => {
    setError(null)
    setCreating(true)
    setStep('creating')

    try {
      const res = await fetch('http://localhost:8000/wiki/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wiki_name: wikiName.trim(),
          wiki_path: parentPath,
          topics: filterEmpty(topics),
          source_types: filterEmpty(sourceTypes),
          folders: folders,
          color: color,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Server error: ${res.status}`)
      }

      const data = await res.json()
      setCreatedWikiId(data.wiki_id)
      setCreatedPath(data.wiki_path)
      setFilesCreated(data.files_created)
      setStep('complete')
      onCreated(data.wiki_id)
    } catch (e) {
      setError(String(e))
      setStep('structure') // Go back to structure step on error
    } finally {
      setCreating(false)
    }
  }

  // Array field helpers
  const addTopic = () => setTopics([...topics, ''])
  const removeTopic = (idx: number) => setTopics(topics.filter((_, i) => i !== idx))
  const updateTopic = (idx: number, val: string) => {
    const newTopics = [...topics]
    newTopics[idx] = val
    setTopics(newTopics)
  }

  const addSourceType = () => setSourceTypes([...sourceTypes, ''])
  const removeSourceType = (idx: number) => setSourceTypes(sourceTypes.filter((_, i) => i !== idx))
  const updateSourceType = (idx: number, val: string) => {
    const newTypes = [...sourceTypes]
    newTypes[idx] = val
    setSourceTypes(newTypes)
  }

  const addFolder = () => setFolders([...folders, { name: '', description: '' }])
  const removeFolder = (idx: number) => setFolders(folders.filter((_, i) => i !== idx))
  const updateFolder = (idx: number, field: 'name' | 'description', val: string) => {
    const newFolders = [...folders]
    newFolders[idx] = { ...newFolders[idx], [field]: val }
    setFolders(newFolders)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--accent)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {step === 'configure' && 'Create Wiki — Configure'}
              {step === 'structure' && 'Create Wiki — Review Structure'}
              {step === 'creating' && 'Creating Wiki...'}
              {step === 'complete' && 'Wiki Created!'}
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Step 1: Configure */}
          {step === 'configure' && (
            <div className="space-y-5">
              <p className="text-sm text-[var(--text-muted)]">
                Tell us about your wiki and we'll propose a folder structure.
              </p>

              {/* Wiki name */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
                  Wiki name
                </label>
                <input
                  type="text"
                  placeholder="my-brain, work-notes, research..."
                  value={wikiName}
                  onChange={(e) => setWikiName(e.target.value)}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)]"
                />
              </div>

              {/* Topics */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
                  Topics you care about
                </label>
                <div className="space-y-2">
                  {topics.map((topic, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g., AI strategy, user research, career..."
                        value={topic}
                        onChange={(e) => updateTopic(idx, e.target.value)}
                        className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)]"
                      />
                      {topics.length > 1 && (
                        <button
                          onClick={() => removeTopic(idx)}
                          className="p-2 text-[var(--text-muted)] hover:text-[var(--error)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addTopic}
                    className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-strong)]"
                  >
                    <Plus size={12} /> Add topic
                  </button>
                </div>
              </div>

              {/* Source types */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
                  What you'll drop into it
                </label>
                <div className="space-y-2">
                  {sourceTypes.map((src, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g., meeting notes, articles, strategy docs..."
                        value={src}
                        onChange={(e) => updateSourceType(idx, e.target.value)}
                        className="flex-1 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-border-strong)]"
                      />
                      {sourceTypes.length > 1 && (
                        <button
                          onClick={() => removeSourceType(idx)}
                          className="p-2 text-[var(--text-muted)] hover:text-[var(--error)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addSourceType}
                    className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-strong)]"
                  >
                    <Plus size={12} /> Add source type
                  </button>
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">
                  Accent color
                </label>
                <div className="flex gap-2">
                  {WIKI_DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        color === c ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--error-faint)] border border-[var(--error-border)] text-[var(--error)] text-sm">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Structure */}
          {step === 'structure' && (
            <div className="space-y-5">
              <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
                <p className="text-sm text-[var(--text-primary)]">{summary}</p>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-2 font-medium uppercase tracking-wider">
                  Proposed folder structure
                </label>
                <div className="space-y-2 text-sm font-mono">
                  <div className="text-[var(--text-muted)]">
                    {wikiName}/
                  </div>
                  <div className="pl-4 text-[var(--text-muted)]">raw/</div>
                  <div className="pl-8 text-[var(--text-secondary)]">inbox/ <span className="text-[var(--text-muted)] font-sans text-xs">— landing zone</span></div>
                  {folders.map((folder, idx) => (
                    <div key={idx} className="pl-8 flex items-center gap-2">
                      <input
                        type="text"
                        value={folder.name}
                        onChange={(e) => updateFolder(idx, 'name', e.target.value)}
                        className="w-24 bg-[var(--bg-base)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] font-mono"
                      />
                      <span className="text-[var(--text-muted)]">—</span>
                      <input
                        type="text"
                        value={folder.description}
                        onChange={(e) => updateFolder(idx, 'description', e.target.value)}
                        className="flex-1 bg-transparent border-none text-xs text-[var(--text-muted)] font-sans outline-none"
                        placeholder="description"
                      />
                      <button
                        onClick={() => removeFolder(idx)}
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--error)]"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addFolder}
                    className="pl-8 flex items-center gap-1.5 text-xs text-[var(--accent)] hover:text-[var(--accent-strong)]"
                  >
                    <Plus size={10} /> Add folder
                  </button>
                  <div className="pl-4 text-[var(--text-muted)]">wiki/</div>
                  <div className="pl-8 text-[var(--text-secondary)]">index.md, log.md, summaries/, people/, projects/, concepts/</div>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--error-faint)] border border-[var(--error-border)] text-[var(--error)] text-sm">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Creating */}
          {step === 'creating' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <Loader2 size={32} className="animate-spin text-[var(--accent)]" />
              <p className="text-sm text-[var(--text-muted)]">Creating your wiki structure...</p>
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--success-faint)] flex items-center justify-center">
                  <CheckCircle2 size={20} className="text-[var(--success)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{wikiName}</p>
                  <p className="text-xs text-[var(--text-muted)] font-mono">{createdPath}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-2 font-medium uppercase tracking-wider">
                  Files created
                </label>
                <div className="max-h-40 overflow-y-auto bg-[var(--bg-base)] border border-[var(--border)] rounded-lg p-3">
                  <ul className="space-y-1 text-xs font-mono text-[var(--text-secondary)]">
                    {filesCreated.map((f, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <FolderPlus size={10} className="text-[var(--success)]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="text-sm text-[var(--text-muted)]">
                Your wiki is ready! Drop files into the inbox to start building your knowledge base.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
          {step === 'configure' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleProposeStructure}
                disabled={proposing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-moderate)] text-sm font-medium disabled:opacity-50"
              >
                {proposing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Thinking...
                  </>
                ) : (
                  <>
                    Propose Structure
                    <ChevronRight size={14} />
                  </>
                )}
              </button>
            </>
          )}

          {step === 'structure' && (
            <>
              <button
                onClick={() => setStep('configure')}
                className="flex items-center gap-1 px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <ChevronLeft size={14} />
                Back
              </button>
              <button
                onClick={handleCreateWiki}
                disabled={creating || folders.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-moderate)] text-sm font-medium disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Create Wiki
                  </>
                )}
              </button>
            </>
          )}

          {step === 'complete' && (
            <button
              onClick={onClose}
              className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-faint)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-moderate)] text-sm font-medium"
            >
              Open Wiki
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
