import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { Link2, ArrowLeft, FileText, Tag, Calendar, BookOpen, Loader2, AlertCircle } from 'lucide-react'
import { useWikiPage } from '../hooks/useWiki'
import type { Components } from 'react-markdown'
import { PAGE_TYPE_COLORS } from '../types'
import 'highlight.js/styles/tokyo-night-dark.css'

/** Pre-process markdown: replace [[WikiLink]] with anchor tags */
function processWikiLinks(content: string, vaultId: string): string {
  return content.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_match, target, label) => {
    const display = label ?? target
    const href = `/vault/${vaultId}/wiki/${target.trim()}`
    return `<a href="${href}" class="wiki-link" data-wiki-link="${target.trim()}">${display}</a>`
  })
}

function FrontmatterBadge({ type }: { type: string }) {
  const color = PAGE_TYPE_COLORS[type] || PAGE_TYPE_COLORS.page
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {type}
    </span>
  )
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[#313244] text-[#a6adc8]">
      <Tag size={10} />
      {tag}
    </span>
  )
}

export default function WikiPage() {
  const params = useParams()
  const navigate = useNavigate()
  const vaultId = params.vaultId ?? ''
  const pageId = params['*'] || 'index'

  const { page, loading, error } = useWikiPage(vaultId, pageId)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-[#89b4fa]" size={24} />
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="flex items-center gap-3 text-[#f38ba8] mb-4">
          <AlertCircle size={20} />
          <span className="font-medium">Page not found: {pageId}</span>
        </div>
        <p className="text-[#6c7086] text-sm">
          This page doesn't exist yet. Ask your LLM to create it, or check the spelling.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 flex items-center gap-2 text-sm text-[#89b4fa] hover:underline"
        >
          <ArrowLeft size={14} />
          Go back
        </button>
      </div>
    )
  }

  const fm = page.frontmatter
  const title = (fm.title as string) || pageId
  const type = (fm.type as string) || 'page'
  const tags = (fm.tags as string[]) || []
  const updated = fm.updated as string
  const sources = fm.sources as number

  const processedContent = processWikiLinks(page.content, vaultId)

  const markdownComponents: Components = {
    a({ href, children, className, ...props }) {
      const isWikiLink = (props as Record<string, unknown>)['data-wiki-link']
      if (isWikiLink && href) {
        return (
          <a
            href={href}
            className="wiki-link"
            onClick={(e) => {
              e.preventDefault()
              navigate(href)
            }}
            {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
          >
            {children}
          </a>
        )
      }
      return (
        <a
          href={href}
          className={className}
          target="_blank"
          rel="noopener noreferrer"
          {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {children}
        </a>
      )
    },
    // Make sure h1 in content doesn't double up with the page title
    h1({ children }) {
      return <h2 className="wiki-prose-h1-demoted">{children}</h2>
    },
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-10">
          {/* Page header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <FrontmatterBadge type={type} />
              {sources > 0 && (
                <span className="flex items-center gap-1 text-xs text-[#6c7086]">
                  <BookOpen size={11} />
                  {sources} source{sources !== 1 ? 's' : ''}
                </span>
              )}
              {updated && (
                <span className="flex items-center gap-1 text-xs text-[#6c7086]">
                  <Calendar size={11} />
                  {updated}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-semibold text-[#cdd6f4] mb-3">{title}</h1>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <TagBadge key={t} tag={t} />
                ))}
              </div>
            )}
          </div>

          {/* Markdown body */}
          <article className="wiki-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight, rehypeRaw]}
              components={markdownComponents}
              skipHtml={false}
            >
              {processedContent}
            </ReactMarkdown>
          </article>
        </div>
      </div>

      {/* Right panel: backlinks & outgoing links */}
      {(page.backlinks.length > 0 || page.links.length > 0) && (
        <aside className="w-56 flex-shrink-0 border-l border-[#313244] overflow-y-auto p-4">
          {page.backlinks.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#6c7086] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Link2 size={11} />
                Backlinks ({page.backlinks.length})
              </h3>
              <ul className="space-y-1">
                {page.backlinks.map((id) => (
                  <li key={id}>
                    <button
                        onClick={() => navigate(`/vault/${vaultId}/wiki/${id}`)}
                        className="text-xs text-[#89dceb] hover:text-[#cdd6f4] text-left w-full truncate hover:underline"
                      >
                        {id.split('/').pop()}
                      </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {page.links.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[#6c7086] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText size={11} />
                Links ({page.links.length})
              </h3>
              <ul className="space-y-1">
                {page.links.map((link) => (
                  <li key={link}>
                    <button
                      onClick={() => navigate(`/vault/${vaultId}/wiki/${link}`)}
                      className="text-xs text-[#89dceb] hover:text-[#cdd6f4] text-left w-full truncate hover:underline"
                    >
                      {link.split('/').pop()}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
