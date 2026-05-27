import { useState, useCallback } from 'react'
import { Outlet, useParams, useNavigate } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, ChevronLeft, Moon } from 'lucide-react'
import SirenIcon from './SirenIcon'
import Sidebar from './Sidebar'
import { usePageList, useWikis, useWikiSocket } from '../hooks/useWiki'
import { useTheme } from '../ThemeContext'
import type { WsEvent } from '../types'

export default function Layout() {
  const { wikiId = '' } = useParams<{ wikiId: string }>()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { theme, toggleTheme } = useTheme()

  const { pages, reload: reloadPages } = usePageList(wikiId)
  const { wikis } = useWikis()
  const wiki = wikis.find((w) => w.id === wikiId)

  const handleWsEvent = useCallback(
    (e: WsEvent) => {
      if ('wikiId' in e.data && e.data.wikiId === wikiId) reloadPages()
    },
    [wikiId, reloadPages]
  )
  useWikiSocket(handleWsEvent)

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      {/* Sidebar */}
      <aside
        className={`wiki-sidebar flex-shrink-0 border-r border-[var(--border)] transition-all duration-200 overflow-hidden ${sidebarOpen ? 'w-72' : 'w-0'}`}
      >
        {sidebarOpen && <Sidebar wikiId={wikiId} pages={pages} mode={wiki?.mode ?? 'wiki'} />}
      </aside>

      {/* Main */}
      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="wiki-topbar flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>

          {/* Wiki breadcrumb */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="All wikis"
          >
            <ChevronLeft size={13} />
            <span>Wikis</span>
          </button>

          {wiki && (
            <>
              <span className="text-[var(--border)]">/</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: wiki.color }} />
                <span className="text-xs font-medium text-[var(--text-primary)]">{wiki.name}</span>
              </div>
            </>
          )}

          <span className="ml-auto text-xs text-[var(--text-muted)]">{pages.length} pages</span>

          <button
            onClick={toggleTheme}
            className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={theme === 'brand' ? 'Switch to dark theme' : 'Switch to brand theme'}
          >
            {theme === 'brand' ? <Moon size={15} /> : <SirenIcon size={15} />}
          </button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto bg-[var(--bg-base)]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
