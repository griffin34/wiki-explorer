import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { renderWithRouter } from '../test-utils'
import LogView from './LogView'

vi.mock('../hooks/useWiki', () => ({
  useLog: vi.fn(),
  useWikiSocket: vi.fn(),
}))
import { useLog } from '../hooks/useWiki'

const sampleEntries = [
  { header: '[2026-05-01] ingest | First source', body: 'Added source content.' },
  { header: '[2026-05-02] query | Research', body: '' },
  { header: '[2026-05-03] edit', body: '' },
  { header: '[2026-05-04] lint | Checking', body: 'Ran lint checks.' },
  { header: '[2026-05-05] init', body: '' },
  { header: 'malformed header with no match', body: 'Body text.' },
]

describe('LogView', () => {
  beforeEach(() => {
    vi.mocked(useLog).mockReturnValue({ entries: [], loading: false })
  })

  it('shows a spinner while loading', () => {
    vi.mocked(useLog).mockReturnValue({ entries: [], loading: true })
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows "No log entries" when empty', () => {
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    expect(screen.getByText(/no log entries/i)).toBeInTheDocument()
  })

  it('renders all entry types with correct icons and labels', async () => {
    vi.mocked(useLog).mockReturnValue({ entries: sampleEntries, loading: false })
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    await waitFor(() => expect(screen.getByText('ingest')).toBeInTheDocument())
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('edit')).toBeInTheDocument()
    expect(screen.getByText('lint')).toBeInTheDocument()
    expect(screen.getByText('init')).toBeInTheDocument()
  })

  it('renders entry titles and dates', async () => {
    vi.mocked(useLog).mockReturnValue({ entries: sampleEntries, loading: false })
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    await waitFor(() => expect(screen.getByText('First source')).toBeInTheDocument())
    expect(screen.getByText('2026-05-01')).toBeInTheDocument()
  })

  it('renders entry body text as markdown', async () => {
    vi.mocked(useLog).mockReturnValue({ entries: sampleEntries, loading: false })
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    await waitFor(() => expect(screen.getByText('Added source content.')).toBeInTheDocument())
  })

  it('displays entry count', async () => {
    vi.mocked(useLog).mockReturnValue({ entries: sampleEntries, loading: false })
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    await waitFor(() => expect(screen.getByText(`(${sampleEntries.length} entries)`)).toBeInTheDocument())
  })

  it('handles a malformed header gracefully', async () => {
    vi.mocked(useLog).mockReturnValue({ entries: sampleEntries, loading: false })
    renderWithRouter(<LogView />, { route: '/wiki/w1/log', path: '/wiki/:wikiId/log' })
    await waitFor(() => expect(screen.getByText('unknown')).toBeInTheDocument())
  })
})
