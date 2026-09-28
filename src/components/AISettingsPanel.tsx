import { useState, useCallback, useEffect } from 'react'
import { X, Loader2, AlertTriangle, KeyRound } from 'lucide-react'
import { api } from '../utils/api'

interface ProviderSettings {
  model: string
}

interface AISettingsResponse {
  active_provider: string
  auto_fallback_to_ollama: boolean
  providers: Record<string, ProviderSettings>
  keys_configured: Record<string, boolean>
}

export const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama (local)',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  xai: 'xAI (Grok)',
}

interface AISettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function AISettingsPanel({ isOpen, onClose }: AISettingsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState('ollama')
  const [autoFallback, setAutoFallback] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [keysConfigured, setKeysConfigured] = useState<Record<string, boolean>>({})

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(api('/api/ai/settings'))
      const data: AISettingsResponse = await res.json()
      setActiveProvider(data.active_provider)
      setAutoFallback(data.auto_fallback_to_ollama)
      setKeysConfigured(data.keys_configured)
      const providerSettings = data.providers[data.active_provider]
      if (providerSettings) {
        setSelectedModel(providerSettings.model)
        setModels([providerSettings.model])
      }
    } catch {
      setError('Could not load AI settings — is the server running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) loadSettings()
  }, [isOpen, loadSettings])

  const handleProviderChange = (providerId: string) => {
    setActiveProvider(providerId)
    setApiKey('')
    setModels([])
    setSelectedModel('')
    setError(null)
  }

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setError(null)
    try {
      if (window.electronAPI?.isElectron) {
        await window.electronAPI.saveProviderKey(activeProvider, apiKey)
      }
      // Stage the key in the (possibly non-Electron) running agent for this
      // session so model-listing can use it even without Electron. This
      // deliberately does NOT touch persisted settings or active_provider —
      // that only happens when the user clicks Save.
      await fetch(api(`/api/ai/providers/${activeProvider}/key`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      })
      const res = await fetch(api(`/api/ai/providers/${activeProvider}/models`))
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not verify this API key')
      }
      const modelList: string[] = await res.json()
      setModels(modelList)
      setSelectedModel(modelList[0] ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify this API key')
    } finally {
      setFetchingModels(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(api('/api/ai/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: activeProvider,
          auto_fallback_to_ollama: autoFallback,
          providers:
            activeProvider === 'ollama' ? {} : { [activeProvider]: { model: selectedModel } },
        }),
      })
      if (!res.ok) throw new Error('Failed to save settings')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const needsKey = activeProvider !== 'ollama'
  const canSave = !needsKey || (models.length > 0 && !!selectedModel)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-elevated)] rounded-lg shadow-xl w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI Provider Settings</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="ai-provider-select" className="block text-xs text-[var(--text-muted)] mb-1">
                Provider
              </label>
              <select
                id="ai-provider-select"
                aria-label="Provider"
                value={activeProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-base)] text-sm"
              >
                {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {needsKey && (
              <>
                <div>
                  <label htmlFor="ai-provider-key" className="block text-xs text-[var(--text-muted)] mb-1">
                    API key {keysConfigured[activeProvider] && '(already set — enter to replace)'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="ai-provider-key"
                      aria-label="API key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-base)] text-sm"
                    />
                    <button
                      onClick={handleFetchModels}
                      disabled={!apiKey || fetchingModels}
                      className="px-2 py-1.5 rounded bg-[var(--accent)] text-white text-xs flex items-center gap-1 disabled:opacity-50"
                    >
                      {fetchingModels ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                      Fetch models
                    </button>
                  </div>
                </div>

                {models.length > 0 && (
                  <div>
                    <label htmlFor="ai-model-select" className="block text-xs text-[var(--text-muted)] mb-1">
                      Model
                    </label>
                    <select
                      id="ai-model-select"
                      aria-label="Model"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-base)] text-sm"
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={autoFallback}
                    onChange={(e) => setAutoFallback(e.target.checked)}
                  />
                  Fall back to Ollama automatically if {PROVIDER_LABELS[activeProvider]} fails
                </label>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-[var(--error,#f38ba8)]">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
