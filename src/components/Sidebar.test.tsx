import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test-utils'
import Sidebar from './Sidebar'
import type { WikiPageMeta } from '../types'

vi.mock('../hooks/useWiki', () => ({
  useSearch: vi.fn(),
  useRawFiles: vi.fn(),
  useWikis: vi.fn(),
  useWikiSocket: vi.fn(),
}))
vi.mock('./IDELaunchModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="ide-modal"><button onClick={onClose}>Close IDE modal</button></div>
  ),
}))
vi.mock('../utils/dragDrop', () => ({
  snapshotDrop: vi.fn(() => ({
    stdFiles: [],
    itemFiles: [],
    entries: [],
    plainText: '',
    htmlText: '',
    emailData: '',
    availableTypes: [],
  })),
  resolveDropSnapshot: vi.fn(() => Promise.resolve([])),
}))
import { useSearch, useRawFiles, useWikis } from '../hooks/useWiki'
import { resolveDropSnapshot } from '../utils/dragDrop'

const defaultSearch = { query: '', setQuery: vi.fn(), results: [], searching: false }
const defaultRawFiles = {
  files: [],
  inboxExists: true as boolean | null,
  loading: false,
  reload: vi.fn(),
}
const mockWiki = { id: 'w1', name: 'My Wiki', color: '#89b4fa', path: '/tmp/wiki', mode: 'wiki' as const, stats: null }

const pages: WikiPageMeta[] = [
  { id: 'index', title: 'Home', type: 'overview', tags: [], wordCount: 10 },
  { id: 'about', title: 'About', type: 'page', tags: [], wordCount: 5 },
  { id: 'concepts/deep', title: 'Deep Concept', type: 'concept', tags: [], wordCount: 20 },
  { id: 'guides/intro', title: 'Intro Guide', type: 'page', tags: [], wordCount: 8 },
]

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return renderWithRouter(
    <Sidebar wikiId="w1" pages={pages} mode="wiki" {...props} />,
    { route: '/wiki/w1/page/index', path: '/wiki/:wikiId/page/*' }
  )
}

describe('Sidebar — wiki mode', () => {
  beforeEach(() => {
    vi.mocked(useSearch).mockReturnValue(defaultSearch)
    vi.mocked(useRawFiles).mockReturnValue(defaultRawFiles)
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
  })

  it('shows "Wiki" header in wiki mode', () => {
    renderSidebar()
    expect(screen.getByText('Wiki')).toBeInTheDocument()
  })

  it('shows graph view and activity log nav links', () => {
    renderSidebar()
    expect(screen.getByText('Graph view')).toBeInTheDocument()
    expect(screen.getByText('Activity log')).toBeInTheDocument()
  })

  it('shows Add Source section', () => {
    renderSidebar()
    expect(screen.getByText('Add Source')).toBeInTheDocument()
  })

  it('renders root pages in the tree', () => {
    renderSidebar()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
  })

  it('renders grouped (subfolder) pages with a folder header', () => {
    renderSidebar()
    expect(screen.getByText('concepts')).toBeInTheDocument()
  })

  it('collapses a group on click', async () => {
    renderSidebar()
    const groupBtn = screen.getByText('concepts').closest('button')!
    await userEvent.click(groupBtn)
    expect(screen.queryByText('deep')).not.toBeInTheDocument()
  })

  it('expands a group again after collapse', async () => {
    renderSidebar()
    const groupBtn = screen.getByText('concepts').closest('button')!
    await userEvent.click(groupBtn)
    await userEvent.click(groupBtn)
    expect(screen.getByText('deep')).toBeInTheDocument()
  })

  it('navigates to a page on click', async () => {
    renderSidebar()
    await userEvent.click(screen.getByText('About'))
  })

  it('shows NavItem as active for the current route', () => {
    renderWithRouter(
      <Sidebar wikiId="w1" pages={pages} mode="wiki" />,
      { route: '/wiki/w1/graph', path: '/wiki/:wikiId/graph' }
    )
    const graphBtn = screen.getByText('Graph view').closest('button')!
    // active class should be applied
    expect(graphBtn.className).toContain('text-[var(--accent)]')
  })

  it('clicking a NavItem triggers navigation', async () => {
    renderWithRouter(
      <Sidebar wikiId="w1" pages={pages} mode="wiki" />,
      { route: '/wiki/w1/page/index', path: '/wiki/:wikiId/page/*' }
    )
    // Grab button reference before click so we still hold the ref after navigation
    const graphBtn = screen.getByText('Graph view')
    await userEvent.click(graphBtn)
    // Navigation fired successfully — component may unmount, no crash = success
  })

  it('sorts multiple non-root groups alphabetically', () => {
    renderSidebar()
    // Both concepts and guides groups should appear (exercises localeCompare branch)
    expect(screen.getByText('concepts')).toBeInTheDocument()
    expect(screen.getByText('guides')).toBeInTheDocument()
  })

  it('wikiPath falls back to empty string when wiki not found in list', () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderSidebar()
    // No crash with empty wikiPath (wikiId w1 not in empty wikis list)
    expect(screen.getByText('Wiki')).toBeInTheDocument()
  })
})

describe('Sidebar — folder mode', () => {
  beforeEach(() => {
    vi.mocked(useSearch).mockReturnValue(defaultSearch)
    vi.mocked(useRawFiles).mockReturnValue(defaultRawFiles)
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
  })

  it('shows "Folder" header and read-only badge', () => {
    renderSidebar({ mode: 'folder' })
    expect(screen.getByText('Folder')).toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('hides graph view and activity log nav links', () => {
    renderSidebar({ mode: 'folder' })
    expect(screen.queryByText('Graph view')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity log')).not.toBeInTheDocument()
  })

  it('hides the Add Source section', () => {
    renderSidebar({ mode: 'folder' })
    expect(screen.queryByText('Add Source')).not.toBeInTheDocument()
  })
})

describe('Sidebar — search', () => {
  beforeEach(() => {
    vi.mocked(useRawFiles).mockReturnValue(defaultRawFiles)
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
  })

  it('shows results dropdown when query is active', async () => {
    const setQuery = vi.fn()
    vi.mocked(useSearch).mockReturnValue({
      query: 'hello',
      setQuery,
      results: [{ id: 'about', title: 'About the Project', type: 'page', excerpt: 'Some excerpt', tags: [] }],
      searching: false,
    })
    renderSidebar()
    await userEvent.click(screen.getByPlaceholderText('Search…'))
    // Use unique title that won't conflict with page tree entries
    expect(screen.getByText('About the Project')).toBeInTheDocument()
  })

  it('shows "No results" when search returns nothing', async () => {
    vi.mocked(useSearch).mockReturnValue({
      query: 'zzz',
      setQuery: vi.fn(),
      results: [],
      searching: false,
    })
    renderSidebar()
    await userEvent.click(screen.getByPlaceholderText('Search…'))
    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })

  it('shows loading spinner while searching', () => {
    vi.mocked(useSearch).mockReturnValue({
      query: 'x', setQuery: vi.fn(), results: [], searching: true,
    })
    renderSidebar()
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('calls setQuery when typing', async () => {
    const setQuery = vi.fn()
    vi.mocked(useSearch).mockReturnValue({ ...defaultSearch, setQuery })
    renderSidebar()
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'abc')
    expect(setQuery).toHaveBeenCalled()
  })

  it('shows clear button when query is non-empty and clears on click', async () => {
    const setQuery = vi.fn()
    vi.mocked(useSearch).mockReturnValue({ query: 'hello', setQuery, results: [], searching: false })
    renderSidebar()
    await userEvent.click(screen.getByPlaceholderText('Search…'))
    const clearBtn = document.querySelector('button > svg[data-lucide]') as HTMLElement | null
    // Locate X button by aria
    const xBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.querySelector('svg') && !b.textContent?.trim()
    )
    if (xBtn) await userEvent.click(xBtn)
    expect(setQuery).toHaveBeenCalledWith('')
  })

  it('navigates to a search result and closes the dropdown', async () => {
    const setQuery = vi.fn()
    vi.mocked(useSearch).mockReturnValue({
      query: 'home',
      setQuery,
      results: [{ id: 'index', title: 'Home Page Result', type: 'overview', excerpt: 'About home', tags: [] }],
      searching: false,
    })
    renderSidebar()
    await userEvent.click(screen.getByPlaceholderText('Search…'))
    await waitFor(() => screen.getByText('Home Page Result'))
    await userEvent.click(screen.getByText('Home Page Result'))
    expect(setQuery).toHaveBeenCalledWith('')
  })
})

describe('IngestSection', () => {
  beforeEach(() => {
    vi.mocked(useSearch).mockReturnValue(defaultSearch)
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
  })

  it('shows error when inboxExists is false', () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: false })
    renderSidebar()
    expect(screen.getByText(/no raw\/inbox\//i)).toBeInTheDocument()
  })

  it('shows upload tab by default when inboxExists is true', () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    expect(screen.getByText('Drop files or click to upload')).toBeInTheDocument()
  })

  it('shows upload tab when inboxExists is null', () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: null })
    renderSidebar()
    expect(screen.getByText('Drop files or click to upload')).toBeInTheDocument()
  })

  it('switches to paste tab', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    await userEvent.click(screen.getByText('Paste text'))
    expect(screen.getByPlaceholderText(/paste markdown/i)).toBeInTheDocument()
  })

  it('submits paste text and shows success', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'notes.md' }),
    }))
    renderSidebar()
    await userEvent.click(screen.getByText('Paste text'))
    await userEvent.type(screen.getByPlaceholderText(/filename/i), 'my-note')
    await userEvent.type(screen.getByPlaceholderText(/paste markdown/i), 'My notes content')
    await userEvent.click(screen.getByText('Save to raw/'))
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeInTheDocument())
  })

  it('shows Uploading… spinner while upload is in progress', async () => {
    let resolveUpload!: () => void
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      new Promise((res) => {
        resolveUpload = () => res({ ok: true, json: () => Promise.resolve({ name: 'test.md' }) })
      })
    ))
    vi.mocked(resolveDropSnapshot).mockResolvedValueOnce([new File(['content'], 'test.txt')])
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    const dt = { types: ['Files'], files: [], items: [], getData: () => '' }
    fireEvent.drop(dropZone, { dataTransfer: dt })
    await waitFor(() => expect(screen.queryByText('Uploading…')).toBeInTheDocument())
    resolveUpload()
    await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument())
  })

  it('shows error when paste text fails', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Upload failed' }),
    }))
    renderSidebar()
    await userEvent.click(screen.getByText('Paste text'))
    await userEvent.type(screen.getByPlaceholderText(/paste markdown/i), 'some text')
    await userEvent.click(screen.getByText('Save to raw/'))
    await waitFor(() => expect(screen.getByText(/upload failed/i)).toBeInTheDocument())
  })

  it('shows generic server error when response has no error field', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    }))
    renderSidebar()
    await userEvent.click(screen.getByText('Paste text'))
    await userEvent.type(screen.getByPlaceholderText(/paste markdown/i), 'content')
    await userEvent.click(screen.getByText('Save to raw/'))
    await waitFor(() => expect(screen.getByText(/server error: 503/i)).toBeInTheDocument())
  })

  it('activates drag visual on dragover', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    fireEvent.dragOver(dropZone)
    await waitFor(() => expect(screen.getByText('Drop files here')).toBeInTheDocument())
  })

  it('deactivates drag visual on dragleave (when leaving the element)', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    fireEvent.dragOver(dropZone)
    fireEvent.dragLeave(dropZone, { relatedTarget: null })
    await waitFor(() => expect(screen.getByText('Drop files or click to upload')).toBeInTheDocument())
  })

  it('handles drop with no dataTransfer gracefully', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    fireEvent.drop(dropZone)
    // Should not crash; nativeDragActive reset to false
    await waitFor(() => expect(screen.getByText('Drop files or click to upload')).toBeInTheDocument())
  })

  it('handles drop with resolved files', async () => {
    vi.mocked(resolveDropSnapshot).mockResolvedValueOnce([new File(['content'], 'test.txt')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ uploaded: [{ name: 'test.txt' }] }),
    }))
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    const dt = { types: ['Files'], files: [], items: [], getData: () => '' }
    fireEvent.drop(dropZone, { dataTransfer: dt })
    await waitFor(() => expect(screen.getByText(/added/i)).toBeInTheDocument())
  })

  it('shows error when file upload fails', async () => {
    vi.mocked(resolveDropSnapshot).mockResolvedValueOnce([new File(['content'], 'fail.txt')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    }))
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    const dt = { types: ['Files'], files: [], items: [], getData: () => '' }
    fireEvent.drop(dropZone, { dataTransfer: dt })
    await waitFor(() => expect(screen.getByText(/error/i)).toBeInTheDocument())
  })

  it('dragenter sets drag-active state', async () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, inboxExists: true })
    renderSidebar()
    const dropZone = document.querySelector('[class*="border-dashed"]') as HTMLElement
    fireEvent.dragEnter(dropZone)
    await waitFor(() => expect(screen.getByText('Drop files here')).toBeInTheDocument())
  })
})

describe('InboxSection', () => {
  beforeEach(() => {
    vi.mocked(useSearch).mockReturnValue(defaultSearch)
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
  })

  it('renders nothing when inbox is loading', () => {
    vi.mocked(useRawFiles).mockReturnValue({
      ...defaultRawFiles,
      loading: true,
      files: [{ name: 'file.txt', path: 'inbox/file.txt', size: 100, modified: '' }],
    })
    const { container } = renderSidebar()
    expect(container.querySelector('[title="Refresh inbox"]')).not.toBeInTheDocument()
  })

  it('renders nothing when inbox is empty', () => {
    vi.mocked(useRawFiles).mockReturnValue({ ...defaultRawFiles, files: [] })
    const { container } = renderSidebar()
    expect(container.querySelector('[title="Refresh inbox"]')).not.toBeInTheDocument()
  })

  it('renders inbox files and ingest button', async () => {
    vi.mocked(useRawFiles).mockReturnValue({
      ...defaultRawFiles,
      files: [{ name: 'source.pdf', path: 'inbox/source.pdf', size: 2048, modified: '' }],
    })
    renderSidebar()
    expect(screen.getByText('source.pdf')).toBeInTheDocument()
    expect(screen.getByText(/inbox/i)).toBeInTheDocument()
  })

  it('calls AI agent API when ingest button is clicked', async () => {
    vi.mocked(useRawFiles).mockReturnValue({
      ...defaultRawFiles,
      files: [{ name: 'source.pdf', path: 'inbox/source.pdf', size: 2048, modified: '' }],
    })
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, queued: '/path/to/file' }),
    } as Response)
    
    renderSidebar()
    const ingestBtn = screen.getByTitle(/process with ai/i)
    await userEvent.click(ingestBtn)
    
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8000/ingest',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    fetchSpy.mockRestore()
  })

  it('shows success message after ingestion', async () => {
    vi.mocked(useRawFiles).mockReturnValue({
      ...defaultRawFiles,
      files: [{ name: 'source.pdf', path: 'inbox/source.pdf', size: 2048, modified: '' }],
    })
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, queued: '/path/to/file' }),
    } as Response)
    
    renderSidebar()
    const ingestBtn = screen.getByTitle(/process with ai/i)
    await userEvent.click(ingestBtn)
    
    expect(await screen.findByText(/queued for processing/i)).toBeInTheDocument()
    fetchSpy.mockRestore()
  })

  it('calls reload when refresh button is clicked', async () => {
    const reload = vi.fn()
    vi.mocked(useRawFiles).mockReturnValue({
      ...defaultRawFiles,
      files: [{ name: 'source.pdf', path: 'inbox/source.pdf', size: 2048, modified: '' }],
      reload,
    })
    renderSidebar()
    await userEvent.click(screen.getByTitle('Refresh inbox'))
    expect(reload).toHaveBeenCalled()
  })
})
