import { Loader2, ScrollText, GitMerge, Search, Wrench, PenLine } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useParams } from 'react-router-dom'
import { useLog } from '../hooks/useWiki'

const ENTRY_ICONS: Record<string, React.ReactNode> = {
  ingest: <GitMerge size={13} />,
  query: <Search size={13} />,
  lint: <Wrench size={13} />,
  edit: <PenLine size={13} />,
  init: <ScrollText size={13} />,
}

const ENTRY_COLORS: Record<string, string> = {
  ingest: '#a6e3a1',
  query: '#89b4fa',
  lint: '#f9e2af',
  edit: '#cba6f7',
  init: '#6c7086',
}

function parseHeader(header: string) {
  // Format: [2026-05-19] type | Optional Title
  const match = header.match(/^\[([^\]]+)\]\s+(\w+)(?:\s*\|\s*(.+))?$/)
  if (!match) return { date: '', type: 'unknown', title: header }
  return {
    date: match[1],
    type: match[2].toLowerCase(),
    title: match[3] || '',
  }
}

export default function LogView() {
  const { wikiId = '' } = useParams<{ wikiId: string }>()
  const { entries, loading } = useLog(wikiId)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-[var(--accent)]" size={24} />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <div className="flex items-center gap-3 mb-8">
        <ScrollText size={20} className="text-[var(--accent)]" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Activity Log</h1>
        <span className="text-sm text-[var(--text-muted)]">({entries.length} entries)</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-[var(--text-muted)]">No log entries yet.</p>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-[var(--bg-elevated)]" />

          <div className="space-y-6">
            {entries.map((entry, i) => {
              const { date, type, title } = parseHeader(entry.header)
              const color = ENTRY_COLORS[type] || '#6c7086'
              const icon = ENTRY_ICONS[type] || <ScrollText size={13} />

              return (
                <div key={i} className="flex gap-4 pl-2">
                  {/* Timeline dot */}
                  <div
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center z-10 mt-0.5"
                    style={{ backgroundColor: `${color}20`, color }}
                  >
                    {icon}
                  </div>

                  {/* Entry content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                      <span
                        className="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${color}15`, color }}
                      >
                        {type}
                      </span>
                      {title && (
                        <span className="text-sm font-medium text-[var(--text-primary)]">{title}</span>
                      )}
                      {date && (
                        <span className="text-xs text-[var(--text-muted)] ml-auto">{date}</span>
                      )}
                    </div>
                    {entry.body && (
                      <div className="wiki-prose text-sm text-[var(--text-secondary)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
