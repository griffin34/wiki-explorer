import { useState, useCallback, useEffect } from 'react'
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
  const [sidebarWidth, setSidebarWidth] = useState(288) // w-72 = 288px
  const [isResizing, setIsResizing] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const { theme, toggleTheme } = useTheme()

  const { pages, reload: reloadPages } = usePageList(wikiId)
  const { wikis } = useWikis()
  const wiki = wikis.find((w) => w.id === wikiId)

  const handleWsEvent = useCallback(
    (e: WsEvent) => {
      if ('wikiId' in e.data && e.data.wikiId === wikiId) {
        reloadPages()
        setRefreshToken((value) => value + 1)
      }
    },
    [wikiId, reloadPages]
  )
  useWikiSocket(handleWsEvent)

  // Resize handlers
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = Math.min(Math.max(200, e.clientX), 600) // min 200px, max 600px
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      {/* Sidebar */}
      <aside
        className={`wiki-sidebar flex-shrink-0 border-r border-[var(--border)] overflow-hidden relative ${sidebarOpen ? '' : 'w-0'}`}
        style={{ width: sidebarOpen ? sidebarWidth : 0, transition: isResizing ? 'none' : 'width 200ms' }}
      >
        {sidebarOpen && <Sidebar wikiId={wikiId} pages={pages} mode={wiki?.mode ?? 'wiki'} />}
        {/* Resize handle */}
        {sidebarOpen && (
          <div
            onMouseDown={startResizing}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent)] transition-colors ${isResizing ? 'bg-[var(--accent)]' : 'bg-transparent'}`}
          />
        )}
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
          <Outlet context={{ refreshToken }} />
        </div>
      </main>
    </div>
  )
}
