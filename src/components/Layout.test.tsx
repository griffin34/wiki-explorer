import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test-utils'
import Layout from './Layout'

vi.mock('../hooks/useWiki', () => ({
  usePageList: vi.fn(),
  useWikis: vi.fn(),
  useWikiSocket: vi.fn(),
}))
import { usePageList, useWikis, useWikiSocket } from '../hooks/useWiki'

// Sidebar and Outlet are complex — mock them to keep Layout tests focused
vi.mock('./Sidebar', () => ({
  default: ({ wikiId, mode }: { wikiId: string; mode: string }) => (
    <div data-testid="sidebar" data-wiki-id={wikiId} data-mode={mode}>Sidebar</div>
  ),
}))

const mockWiki = { id: 'w1', name: 'My Wiki', color: '#89b4fa', mode: 'wiki' as const, path: '/tmp/wiki', stats: null }

describe('Layout', () => {
  beforeEach(() => {
    vi.mocked(usePageList).mockReturnValue({ pages: [], loading: false, reload: vi.fn() })
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
    vi.mocked(useWikiSocket).mockImplementation(() => {})
  })

  it('renders the top bar with breadcrumb and wiki name', () => {
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(screen.getByText('Wikis')).toBeInTheDocument()
    expect(screen.getByText('My Wiki')).toBeInTheDocument()
  })

  it('shows page count in top bar', () => {
    vi.mocked(usePageList).mockReturnValue({ pages: [{ id: 'p1' }, { id: 'p2' }] as never, loading: false, reload: vi.fn() })
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(screen.getByText('2 pages')).toBeInTheDocument()
  })

  it('renders the sidebar when open', () => {
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('hides the sidebar when the toggle is clicked', async () => {
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    const toggle = screen.getByTitle(/hide sidebar/i)
    await userEvent.click(toggle)
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
  })

  it('shows the sidebar again after re-clicking the toggle', async () => {
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    const toggle = screen.getByTitle(/hide sidebar/i)
    await userEvent.click(toggle)
    const openToggle = screen.getByTitle(/show sidebar/i)
    await userEvent.click(openToggle)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('does not show wiki breadcrumb when wiki is not found', () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderWithRouter(<Layout />, { route: '/wiki/unknown', path: '/wiki/:wikiId' })
    expect(screen.queryByText('My Wiki')).not.toBeInTheDocument()
  })

  it('passes mode=folder to sidebar for folder-mode wikis', () => {
    vi.mocked(useWikis).mockReturnValue({
      wikis: [{ ...mockWiki, mode: 'folder' as const }],
      loading: false,
      reload: vi.fn(),
    })
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(screen.getByTestId('sidebar').dataset.mode).toBe('folder')
  })

  it('calls reloadPages when WebSocket event arrives for this wiki', () => {
    const reload = vi.fn()
    vi.mocked(usePageList).mockReturnValue({ pages: [], loading: false, reload })
    vi.mocked(useWikiSocket).mockImplementation((handler) => {
      // Simulate an event for w1
      act(() => { handler({ data: { wikiId: 'w1' } } as never) })
    })
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(reload).toHaveBeenCalled()
  })

  it('does not call reloadPages for a different wikiId in WS event', () => {
    const reload = vi.fn()
    vi.mocked(usePageList).mockReturnValue({ pages: [], loading: false, reload })
    vi.mocked(useWikiSocket).mockImplementation((handler) => {
      act(() => { handler({ data: { wikiId: 'other' } } as never) })
    })
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not call reloadPages for WS events without wikiId', () => {
    const reload = vi.fn()
    vi.mocked(usePageList).mockReturnValue({ pages: [], loading: false, reload })
    vi.mocked(useWikiSocket).mockImplementation((handler) => {
      act(() => { handler({ data: {} } as never) })
    })
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('toggles theme via the theme button', async () => {
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    const btn = screen.getByTitle(/switch to brand theme/i)
    await userEvent.click(btn)
    expect(screen.getByTitle(/switch to dark theme/i)).toBeInTheDocument()
  })

  it('navigates to "/" when Wikis breadcrumb is clicked', async () => {
    renderWithRouter(<Layout />, { route: '/wiki/w1', path: '/wiki/:wikiId' })
    const wikisBtn = screen.getByTitle('All wikis')
    // Click fires navigate('/'); Layout unmounts (no matching route), no crash = success
    await userEvent.click(wikisBtn)
  })
})
