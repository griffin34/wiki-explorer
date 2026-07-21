import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test-utils'
import GraphView from './GraphView'

vi.mock('../hooks/useWiki', () => ({
  useGraphData: vi.fn(),
  useWikiSocket: vi.fn(),
}))
import { useGraphData } from '../hooks/useWiki'

const mockGraph = {
  nodes: [
    { id: 'index', title: 'Home', type: 'overview', linkCount: 3, wordCount: 100 },
    { id: 'about', title: 'About', type: 'page', linkCount: 1, wordCount: 50 },
    { id: 'concepts', title: 'Concepts', type: 'concept', linkCount: 2, wordCount: 200 },
    // unknown type triggers the || PAGE_TYPE_COLORS.page fallback
    { id: 'misc', title: 'Misc', type: 'unknown-type', linkCount: 0, wordCount: 10 },
  ],
  links: [
    { source: 'index', target: 'about' },
    { source: 'index', target: 'concepts' },
  ],
}

describe('GraphView', () => {
  beforeEach(() => {
    vi.mocked(useGraphData).mockReturnValue({ graph: null, loading: true })
  })

  it('shows loading spinner while loading', () => {
    renderWithRouter(<GraphView />, { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders the SVG when graph data is available', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: mockGraph, loading: false })
    const { container } = renderWithRouter(<GraphView />, {
      route: '/wiki/w1/graph',
      path: '/wiki/:wikiId/graph',
    })
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())
  })

  it('shows the legend and zoom controls', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: mockGraph, loading: false })
    renderWithRouter(<GraphView />, { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' })
    await waitFor(() => expect(screen.getByText(/node size/i)).toBeInTheDocument())
    expect(screen.getByTitle('Zoom in')).toBeInTheDocument()
    expect(screen.getByTitle('Zoom out')).toBeInTheDocument()
    expect(screen.getByTitle('Reset view')).toBeInTheDocument()
  })

  it('shows the filter toggle button', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: mockGraph, loading: false })
    renderWithRouter(<GraphView />, { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' })
    await waitFor(() => expect(screen.getByText('Filter')).toBeInTheDocument())
  })

  it('opens and closes the filter panel', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: mockGraph, loading: false })
    renderWithRouter(<GraphView />, { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' })
    await waitFor(() => screen.getByText('Filter'))
    await userEvent.click(screen.getByText('Filter'))
    expect(screen.getByText(/page types/i)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Filter'))
    expect(screen.queryByText(/page types/i)).not.toBeInTheDocument()
  })

  it('toggles a filter type off and back on', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: mockGraph, loading: false })
    renderWithRouter(<GraphView />, { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' })
    await waitFor(() => screen.getByText('Filter'))
    await userEvent.click(screen.getByText('Filter'))
    const overviewCheckbox = screen.getByRole('checkbox', { name: /overview/i })
    await userEvent.click(overviewCheckbox)
    expect(overviewCheckbox).not.toBeChecked()
    await userEvent.click(overviewCheckbox)
    expect(overviewCheckbox).toBeChecked()
  })

  it('calls zoom in/out/reset without throwing', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: mockGraph, loading: false })
    renderWithRouter(<GraphView />, { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' })
    await waitFor(() => screen.getByTitle('Zoom in'))
    await userEvent.click(screen.getByTitle('Zoom in'))
    await userEvent.click(screen.getByTitle('Zoom out'))
    await userEvent.click(screen.getByTitle('Reset view'))
  })

  it('renders with an empty graph (no nodes)', async () => {
    vi.mocked(useGraphData).mockReturnValue({ graph: { nodes: [], links: [] }, loading: false })
    const { container } = renderWithRouter(<GraphView />, {
      route: '/wiki/w1/graph',
      path: '/wiki/:wikiId/graph',
    })
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument())
  })
})
