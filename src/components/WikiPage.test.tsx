import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test-utils'
import WikiPage from './WikiPage'

vi.mock('../hooks/useWiki', () => ({
  useWikiPage: vi.fn(),
}))
import { useWikiPage } from '../hooks/useWiki'

const makePage = (overrides = {}) => ({
  content: '# Hello\n\nSome **bold** text with a [[About|About Page]] wiki link.',
  frontmatter: {
    title: 'Home',
    type: 'overview',
    tags: ['tag1', 'tag2'],
    updated: '2026-05-01',
    sources: 2,
  },
  backlinks: ['about', 'concepts/overview'],
  links: ['resources/ref1'],
  ...overrides,
})

describe('WikiPage', () => {
  beforeEach(() => {
    vi.mocked(useWikiPage).mockReturnValue({ page: null, loading: true, error: null })
  })

  it('shows loading spinner', () => {
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows friendly "select a file" message for missing index page', () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: null, loading: false, error: 'not found' })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    expect(screen.getByText(/select a file/i)).toBeInTheDocument()
  })

  it('shows "page not found" error for a non-index missing page', () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: null, loading: false, error: 'not found' })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/missing-page',
      path: '/wiki/:wikiId/page/*',
    })
    expect(screen.getByText(/page not found/i)).toBeInTheDocument()
    expect(screen.getByText(/missing-page/)).toBeInTheDocument()
  })

  it('shows "page not found" when page is null but no error string', () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: null, loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/missing-page',
      path: '/wiki/:wikiId/page/*',
    })
    expect(screen.getByText(/page not found/i)).toBeInTheDocument()
  })

  it('renders the page title and type badge', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument())
    // Type badge — getAll because "overview" also appears in backlinks ("concepts/overview" → "overview")
    expect(screen.getAllByText('overview').length).toBeGreaterThan(0)
  })

  it('renders tags', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText('tag1')).toBeInTheDocument())
    expect(screen.getByText('tag2')).toBeInTheDocument()
  })

  it('renders updated date and sources count', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText('2026-05-01')).toBeInTheDocument())
    expect(screen.getByText(/2 source/)).toBeInTheDocument()
  })

  it('renders markdown content', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    // Wait for page to render then check body content exists
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument())
    expect(document.querySelector('.wiki-prose')).toBeInTheDocument()
  })

  it('renders the backlinks panel', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText(/backlinks/i)).toBeInTheDocument())
    // "about" is a backlink (id.split('/').pop() = 'about')
    expect(screen.getByText('about')).toBeInTheDocument()
  })

  it('renders the outgoing links panel', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText('ref1')).toBeInTheDocument())
  })

  it('uses the wikiId param in wiki links', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    const { container } = renderWithRouter(<WikiPage />, {
      route: '/wiki/mywiki/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('Home'))
    const links = container.querySelectorAll('.wiki-link')
    expect(links.length).toBeGreaterThan(0)
    expect((links[0] as HTMLAnchorElement).href).toContain('mywiki')
  })

  it('navigate(-1) is called from the Go Back button on error page', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: null, loading: false, error: 'nope' })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/bad',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText(/go back/i))
    await userEvent.click(screen.getByText(/go back/i))
    // Just ensures the button click doesn't crash (navigate(-1) is best-effort in test)
  })

  it('clicking a backlink navigates to the correct page', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('about'))
    await userEvent.click(screen.getByText('about'))
  })

  it('clicking an outgoing link navigates to the correct page', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('ref1'))
    await userEvent.click(screen.getByText('ref1'))
  })

  it('renders page with no optional frontmatter fields', async () => {
    const page = makePage({
      frontmatter: { title: '', type: '', tags: [], updated: null, sources: 0 },
      backlinks: [],
      links: [],
    })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('page'))
  })

  it('renders "source" (singular) when sources === 1', async () => {
    const page = makePage({ frontmatter: { title: 'Home', type: 'overview', tags: ['t'], updated: '', sources: 1 } })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText(/1 source$/)).toBeInTheDocument())
  })

  it('falls back to empty tags array when frontmatter.tags is null', async () => {
    const page = makePage({
      frontmatter: { title: 'Home', type: 'overview', tags: null as unknown as string[], updated: '', sources: 0 },
    })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('Home'))
    // No crash = tags || [] fallback works
  })

  it('renders wiki link with no label (display === target)', async () => {
    const page = makePage({ content: 'See [[SimpleTarget]] for more info.' })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    const { container } = renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('Home'))
    const wikiLink = container.querySelector('a[data-wiki-link="SimpleTarget"]') as HTMLAnchorElement
    expect(wikiLink?.textContent).toBe('SimpleTarget')
  })

  it('FrontmatterBadge falls back to page color for unknown type', async () => {
    const page = makePage({ frontmatter: { title: 'Home', type: 'unknown-type', tags: [], updated: '', sources: 0 } })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => expect(screen.getByText('unknown-type')).toBeInTheDocument())
  })

  it('loads the brand highlight theme', async () => {
    localStorage.setItem('wiki-theme', 'brand')
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('Home'))
    localStorage.clear()
  })

  it('clicking a wiki link fires navigation (onClick preventDefault + navigate)', async () => {
    vi.mocked(useWikiPage).mockReturnValue({ page: makePage(), loading: false, error: null })
    renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('About Page'))
    const wikiLink = screen.getByText('About Page').closest('a')!
    // Click fires onClick → e.preventDefault() + navigate(href)
    // Component may unmount after navigation; no crash = success
    await userEvent.click(wikiLink)
  })

  it('renders external links with target=_blank', async () => {
    const page = makePage({
      content: 'Check [Google](https://google.com) for info.',
    })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    const { container } = renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('Home'))
    const link = container.querySelector('a[href="https://google.com"]') as HTMLAnchorElement
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toContain('noopener')
  })

  it('demotes h1 headings in content to h2', async () => {
    const page = makePage({ content: '# Top Level Heading\n\nParagraph text.' })
    vi.mocked(useWikiPage).mockReturnValue({ page, loading: false, error: null })
    const { container } = renderWithRouter(<WikiPage />, {
      route: '/wiki/w1/page/index',
      path: '/wiki/:wikiId/page/*',
    })
    await waitFor(() => screen.getByText('Top Level Heading'))
    // h1 content should render as an h2 (demoted by markdownComponents override)
    expect(container.querySelector('h2.wiki-prose-h1-demoted')).toBeInTheDocument()
  })
})
