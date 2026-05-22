import { useState, useCallback } from 'react'
import { Outlet, useParams, useNavigate } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, ChevronLeft } from 'lucide-react'
import Sidebar from './Sidebar'
import { usePageList, useVaults, useWikiSocket } from '../hooks/useWiki'
import type { WsEvent } from '../types'

export default function Layout() {
  const { vaultId = '' } = useParams<{ vaultId: string }>()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const { pages, reload: reloadPages } = usePageList(vaultId)
  const { vaults } = useVaults()
  const vault = vaults.find((v) => v.id === vaultId)

  const handleWsEvent = useCallback(
    (e: WsEvent) => {
      if ('vaultId' in e.data && e.data.vaultId === vaultId) reloadPages()
    },
    [vaultId, reloadPages]
  )
  useWikiSocket(handleWsEvent)

  return (
    <div className="flex h-screen overflow-hidden bg-[#1e1e2e]">
      {/* Sidebar */}
      <aside
        className={`flex-shrink-0 border-r border-[#313244] bg-[#181825] transition-all duration-200 overflow-hidden ${sidebarOpen ? 'w-72' : 'w-0'}`}
      >
        {sidebarOpen && <Sidebar vaultId={vaultId} pages={pages} />}
      </aside>

      {/* Main */}
      <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#313244] bg-[#1e1e2e] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded hover:bg-[#313244] text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>

          {/* Vault breadcrumb */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
            title="All vaults"
          >
            <ChevronLeft size={13} />
            <span>Vaults</span>
          </button>

          {vault && (
            <>
              <span className="text-[#313244]">/</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: vault.color }} />
                <span className="text-xs font-medium text-[#cdd6f4]">{vault.name}</span>
              </div>
            </>
          )}

          <span className="ml-auto text-xs text-[#6c7086]">{pages.length} pages</span>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
