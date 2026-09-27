import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Sparkles, Send, Loader2, BookOpen, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../utils/api'

interface SearchSource {
  title: string
  file: string
  wiki_page?: string
  excerpt: string
  score: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: SearchSource[]
  error?: boolean
}

export default function AISearch() {
  const { wikiId = '' } = useParams<{ wikiId: string }>()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const triggerReindex = useCallback(async () => {
    if (reindexing) return
    setReindexing(true)
    try {
      const res = await fetch(api(`/api/ai/wikis/${wikiId}/reindex`), { method: 'POST' })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('AI service not available. Start it with `./start-ai.sh`.')
      }
      const data = await res.json()
      if (data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Reindex started: ${data.files_queued} files queued for processing. You'll see progress in the sidebar.`,
          },
        ])
      } else {
        throw new Error(data.error || 'Reindex failed')
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Failed to start reindex. Is the AI service running?',
          error: true,
        },
      ])
    } finally {
      setReindexing(false)
    }
  }, [reindexing, wikiId])

  const submit = useCallback(async () => {
    const query = input.trim()
    if (!query || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: query }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(api('/api/ai/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wiki_id: wikiId, query, top_k: 10 }),
      })

      if (res.status === 503) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'The AI agent service is not running. Start it with `./start-ai.sh`.',
            error: true,
          },
        ])
        return
      }

      const data = (await res.json()) as { answer?: string; sources?: SearchSource[] }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer ?? 'No answer returned.',
          sources: data.sources ?? [],
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'The AI agent service is not running. Start it with `./start-ai.sh`.',
          error: true,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [input, loading, wikiId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="min-h-0 flex flex-col h-full bg-[var(--bg-base)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Sparkles size={18} className="text-[var(--accent)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)] flex-1">AI Search</h1>
          <button
            onClick={() => void triggerReindex()}
            disabled={reindexing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
            title="Re-scan and reindex all documents"
          >
            <RefreshCw size={12} className={reindexing ? 'animate-spin' : ''} />
            {reindexing ? 'Reindexing…' : 'Reindex'}
          </button>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Ask questions about this wiki</p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !loading ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
            <div className="p-4 rounded-full bg-[var(--accent-faint)]">
              <Sparkles size={32} className="text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-[var(--text-primary)] font-medium mb-1">Ask anything about your wiki</p>
              <p className="text-sm text-[var(--text-muted)]">
                Try: "What are the main topics?" · "Summarise my notes on X" · "What links to Y?"
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-[var(--accent)] text-white'
                      : msg.error
                      ? 'bg-[var(--error-faint,rgba(243,139,168,0.12))] border border-[var(--error-border,rgba(243,139,168,0.3))] text-[var(--error,#f38ba8)]'
                      : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)]'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>

                  {/* Source cards */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
                        <BookOpen size={11} />
                        Sources
                      </p>
                      {msg.sources.map((src, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="font-medium text-[var(--text-primary)] truncate">{src.title}</span>
                            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-faint)] text-[var(--accent)] font-mono">
                              {Math.round(src.score * 100)}% match
                            </span>
                          </div>
                          <p className="text-[var(--text-muted)] line-clamp-2 mb-1.5">{src.excerpt}</p>
                          {src.wiki_page && (
                            <button
                              onClick={() => navigate(`/wiki/${wikiId}/page/${src.wiki_page}`)}
                              className="flex items-center gap-1 text-[var(--accent)] hover:underline"
                            >
                              <ExternalLink size={10} />
                              View wiki page
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Loading placeholder */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="animate-pulse">Thinking…</span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[var(--border)] px-6 py-4">
        <div className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-2.5 focus-within:border-[var(--accent-border-strong,var(--accent))]">
          <input
            type="text"
            placeholder="Ask a question about this wiki…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none disabled:opacity-50"
          />
          <button
            onClick={() => void submit()}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
