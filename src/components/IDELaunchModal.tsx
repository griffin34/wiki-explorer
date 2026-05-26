import { useState, useEffect } from 'react'
import { MonitorPlay, Loader2, CheckCircle2, Check, X } from 'lucide-react'
import { detectIDEs, openInIDE } from '../hooks/useWiki'
import type { IDEInfo } from '../hooks/useWiki'

const IDE_COLORS: Record<string, string> = {
  cursor:    '#89b4fa',
  vscode:    '#4fc3f7',
  windsurf:  '#a6e3a1',
  intellij:  '#f38ba8',
  webstorm:  '#89dceb',
  pycharm:   '#cba6f7',
}

/**
 * Per-IDE chat command used when the command is context-dependent (e.g. wiki
 * creation). Pass `fixedCommand` instead when all IDEs should receive the same
 * text (e.g. an ADD ingest prompt).
 */
/** Write text to clipboard; falls back to the legacy execCommand approach. */
export async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export const IDE_CREATE_COMMANDS: Record<string, string> = {
  cursor:   'create my wiki',
  vscode:   '/create-wiki',
  windsurf: '/create-wiki',
  intellij: '/create-wiki',
  webstorm: '/create-wiki',
  pycharm:  '/create-wiki',
}

interface Props {
  /** Shown in the modal heading */
  title?: string
  /** Filesystem path of the wiki folder to open in the IDE */
  wikiPath: string
  /** If provided every IDE copies this same text */
  fixedCommand?: string
  /** If provided each IDE copies its own entry (falls back to /create-wiki) */
  commandMap?: Record<string, string>
  onClose: () => void
}

export default function IDELaunchModal({ title, wikiPath, fixedCommand, commandMap, onClose }: Props) {
  const [ides, setIDEs] = useState<IDEInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState<string | null>(null)
  const [launched, setLaunched] = useState<string | null>(null)
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)

  useEffect(() => {
    detectIDEs().then((detected) => { setIDEs(detected); setLoading(false) })
  }, [])

  // Reset per-session state and pre-copy the fixed command as soon as the
  // modal opens (or the target changes), so the clipboard is always current
  // even before the user selects an IDE.
  useEffect(() => {
    setLaunched(null)
    setCopiedCommand(null)
    if (fixedCommand) {
      writeToClipboard(fixedCommand).catch(() => {})
      setCopiedCommand(fixedCommand)
    }
  }, [fixedCommand])

  const handleOpen = async (ide: IDEInfo) => {
    const command = fixedCommand
      ?? commandMap?.[ide.id]
      ?? IDE_CREATE_COMMANDS[ide.id]
      ?? '/create-wiki'

    // Copy BEFORE opening the IDE — the browser window must still be focused
    // for the Clipboard API to work. Once the IDE is brought to the front the
    // document loses focus and writeText() throws NotAllowedError.
    await writeToClipboard(command)
    setCopiedCommand(command)

    setLaunching(ide.id)
    try {
      await openInIDE(ide.id, wikiPath)
    } catch {
      // non-fatal: IDE may already be focused
    } finally {
      setLaunching(null)
    }
    setLaunched(ide.id)
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-80 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl p-5 space-y-4">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <X size={14} />
        </button>

        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {title ?? 'Open in editor'}
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Select your editor — the command will be copied to your clipboard.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-sm">Detecting installed editors…</span>
          </div>
        ) : ides.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No supported editors detected.</p>
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
                    {isLaunching ? 'Focusing…' : isLaunched ? 'Done!' : ide.name}
                  </span>
                  {isLaunching && <Loader2 size={12} className="animate-spin ml-auto" style={{ color }} />}
                  {isLaunched && <CheckCircle2 size={12} className="ml-auto" style={{ color }} />}
                </button>
              )
            })}
          </div>
        )}

        {/* Copied command callout */}
        {copiedCommand && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--accent-faint)] border border-[var(--accent-border)]">
            <Check size={14} className="text-[var(--accent)] mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-[var(--text-secondary)] leading-snug">
                Copied — paste into the editor chat:
              </p>
              <code className="text-xs font-mono font-semibold text-[var(--accent)] mt-0.5 block break-all">
                {copiedCommand}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
