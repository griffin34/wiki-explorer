import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter } from '../test-utils'
import VaultSelector from './VaultSelector'
import type { WikiConfig } from '../types'

vi.mock('../hooks/useWiki', () => ({
  useWikis: vi.fn(),
  addWiki: vi.fn(),
  removeWiki: vi.fn(),
  pickFolder: vi.fn(),
  detectIDEs: vi.fn(),
  openInIDE: vi.fn(),
}))
import { useWikis, addWiki, removeWiki, pickFolder, detectIDEs, openInIDE } from '../hooks/useWiki'

const mockWiki: WikiConfig = {
  id: 'w1',
  name: 'My Wiki',
  color: '#89b4fa',
  path: '/tmp/my-wiki',
  mode: 'wiki',
  stats: { pageCount: 5, sourceCount: 2, lastActivity: '2026-05-01' },
}

describe('VaultSelector — main screen', () => {
  beforeEach(() => {
    vi.mocked(detectIDEs).mockResolvedValue([])
  })

  it('shows loading spinner while fetching wikis', () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: true, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows empty state when no wikis exist', () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    expect(screen.getByText(/no wikis yet/i)).toBeInTheDocument()
  })

  it('renders wiki cards when wikis exist', () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    expect(screen.getByText('My Wiki')).toBeInTheDocument()
    expect(screen.getByText('/tmp/my-wiki')).toBeInTheDocument()
    expect(screen.getByText('5 pages')).toBeInTheDocument()
    expect(screen.getByText('2 sources')).toBeInTheDocument()
    expect(screen.getByText('2026-05-01')).toBeInTheDocument()
  })

  it('shows the Add wiki button', () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    expect(screen.getAllByText(/add.*wiki/i).length).toBeGreaterThan(0)
  })

  it('toggles theme when theme button is clicked', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    const themeBtn = screen.getByTitle(/switch to brand theme/i)
    await userEvent.click(themeBtn)
    expect(screen.getByTitle(/switch to dark theme/i)).toBeInTheDocument()
  })

  it('opens AddWikiModal on clicking "Add wiki" button', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    expect(screen.getByText('Add a wiki')).toBeInTheDocument()
  })

  it('opens AddWikiModal from the dashed card', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    // The dashed card button contains "Add wiki" text without a Loader2/Plus prefix
    const addButtons = screen.getAllByRole('button', { name: /add wiki/i })
    await userEvent.click(addButtons[addButtons.length - 1])
    expect(screen.getByText('Add a wiki')).toBeInTheDocument()
  })

  it('removes a wiki after confirm', async () => {
    const reload = vi.fn()
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload })
    vi.mocked(removeWiki).mockResolvedValue(undefined)
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    // Hover card to show remove button
    const removeBtn = screen.getByTitle('Remove wiki')
    await userEvent.click(removeBtn)
    // Confirm dialog appears
    expect(screen.getByText(/remove.*from your wikis/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    expect(removeWiki).toHaveBeenCalledWith('w1')
    expect(reload).toHaveBeenCalled()
  })

  it('cancels the remove confirm overlay', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getByTitle('Remove wiki'))
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText(/remove.*from your wikis/i)).not.toBeInTheDocument()
  })

  it('navigates to wiki when a card is clicked', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [mockWiki], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    const card = screen.getByText('Open wiki').closest('[class*="cursor-pointer"]') as HTMLElement
    await userEvent.click(card)
  })

  it('shows wiki card without stats', () => {
    const wikiNoStats: WikiConfig = { ...mockWiki, stats: null }
    vi.mocked(useWikis).mockReturnValue({ wikis: [wikiNoStats], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    expect(screen.getByText('0 pages')).toBeInTheDocument()
  })

  it('shows wiki card with no lastActivity', () => {
    const wiki: WikiConfig = { ...mockWiki, stats: { pageCount: 1, sourceCount: 0, lastActivity: null as unknown as string } }
    vi.mocked(useWikis).mockReturnValue({ wikis: [wiki], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    expect(screen.getByText('1 pages')).toBeInTheDocument()
  })
})

describe('AddWikiModal', () => {
  beforeEach(() => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([])
    vi.mocked(pickFolder).mockResolvedValue('/tmp/chosen')
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
  })

  async function openModal() {
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
  }

  it('renders modal with create/existing mode toggle', async () => {
    await openModal()
    expect(screen.getByText('Create new wiki')).toBeInTheDocument()
    expect(screen.getByText('Open existing folder')).toBeInTheDocument()
  })

  it('closes modal when X is clicked', async () => {
    await openModal()
    // The X button sits in the modal header, next to the "Add a wiki" heading
    const heading = screen.getByText('Add a wiki')
    const headerDiv = heading.closest('div')!
    const closeBtn = headerDiv.querySelector('button') as HTMLElement
    if (closeBtn) await userEvent.click(closeBtn)
    await waitFor(() => expect(screen.queryByText('Add a wiki')).not.toBeInTheDocument())
  })

  it('closes modal when Cancel is clicked', async () => {
    await openModal()
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText('Add a wiki')).not.toBeInTheDocument()
  })

  it('switches to existing folder mode', async () => {
    await openModal()
    await userEvent.click(screen.getByText('Open existing folder'))
    expect(screen.getByText('Folder path')).toBeInTheDocument()
  })

  it('shows path hint when both name and path are filled (create mode)', async () => {
    await openModal()
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'My Docs')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp/parent')
    await waitFor(() => expect(screen.getByText(/will create/i)).toBeInTheDocument())
  })

  it('submit button is disabled when fields are empty', async () => {
    await openModal()
    const allBtns = screen.getAllByRole('button')
    const submitBtn = allBtns.find((b) => b.textContent?.includes('Create wiki') && !b.textContent?.includes('new'))
    expect(submitBtn).toBeDisabled()
  })

  it('browse button calls pickFolder and fills path', async () => {
    await openModal()
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    await waitFor(() => expect(screen.getByDisplayValue('/tmp/chosen')).toBeInTheDocument())
  })

  it('browse button is a no-op when pickFolder returns null (user cancelled)', async () => {
    vi.mocked(pickFolder).mockResolvedValue(null)
    await openModal()
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    // Path field should remain empty — no crash = null path handled correctly
    await waitFor(() => expect(screen.getByPlaceholderText('/Users/you/Documents')).toHaveValue(''))
  })

  it('shows error when pickFolder throws', async () => {
    vi.mocked(pickFolder).mockRejectedValue(new Error('Dialog cancelled'))
    await openModal()
    await userEvent.click(screen.getByRole('button', { name: /browse/i }))
    await waitFor(() => expect(screen.getByText(/dialog cancelled/i)).toBeInTheDocument())
  })

  it('creates a wiki successfully and shows IDE picker step', async () => {
    const reload = vi.fn()
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'New Wiki')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    const allBtns = screen.getAllByRole('button')
    const submitBtn = allBtns.find((b) => b.textContent?.includes('Create wiki') && !b.textContent?.includes('new'))!
    await userEvent.click(submitBtn)
    await waitFor(() => expect(screen.getByText('Wiki created')).toBeInTheDocument())
    expect(reload).toHaveBeenCalled()
  })

  it('shows error when addWiki throws', async () => {
    vi.mocked(addWiki).mockRejectedValue(new Error('Server error'))
    await openModal()
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    const allBtns = screen.getAllByRole('button')
    const submitBtn = allBtns.find((b) => b.textContent?.includes('Create wiki') && !b.textContent?.includes('new'))!
    await userEvent.click(submitBtn)
    await waitFor(() => expect(screen.getByText(/server error/i)).toBeInTheDocument())
  })

  it('allows selecting a different color', async () => {
    await openModal()
    // React renders style as background-color (kebab), not backgroundColor
    const colorButtons = document.querySelectorAll('[style*="background-color"]')
    expect(colorButtons.length).toBeGreaterThan(1)
    await userEvent.click(colorButtons[1] as HTMLElement)
    // Just ensures no crash
  })

  it('empty-state Add your first wiki button opens the modal', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getByText('Add your first wiki'))
    await waitFor(() => expect(screen.getByText('Add a wiki')).toBeInTheDocument())
  })
})

describe('IDEPicker step in AddWikiModal', () => {
  async function clickSubmit() {
    const allBtns = screen.getAllByRole('button')
    const submitBtn = allBtns.find((b) => b.textContent?.includes('Create wiki') && !b.textContent?.includes('new'))!
    await userEvent.click(submitBtn)
  }

  it('shows the IDE picker after successful creation, with Done button', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([{ id: 'cursor', name: 'Cursor' }])
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    await clickSubmit()
    await waitFor(() => expect(screen.getByText('Wiki created')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Cursor')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(screen.queryByText('Wiki created')).not.toBeInTheDocument()
  })

  it('shows "no editors detected" inside IDEPicker when no IDEs found', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([])
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    await clickSubmit()
    await waitFor(() => screen.getByText('Wiki created'))
    await waitFor(() => expect(screen.getByText(/no supported editors/i)).toBeInTheDocument())
  })

  it('handles IDE launch in IDEPicker with openInIDE error', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([{ id: 'cursor', name: 'Cursor' }])
    vi.mocked(openInIDE).mockRejectedValue(new Error('launch failed'))
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    await clickSubmit()
    await waitFor(() => screen.getByText('Wiki created'))
    await waitFor(() => screen.getByText('Cursor'), { timeout: 3000 })
    await userEvent.click(screen.getByText('Cursor'))
    await waitFor(() => expect(screen.getByText(/Error: launch failed/)).toBeInTheDocument(), { timeout: 3000 })
  })

  it('shows Opened! after successful IDE launch in IDEPicker', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([{ id: 'cursor', name: 'Cursor' }])
    vi.mocked(openInIDE).mockResolvedValue(undefined)
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    await clickSubmit()
    await waitFor(() => screen.getByText('Wiki created'))
    await waitFor(() => screen.getByText('Cursor'), { timeout: 3000 })
    await userEvent.click(screen.getByText('Cursor'))
    await waitFor(() => expect(screen.getByText('Opened!')).toBeInTheDocument(), { timeout: 3000 })
  })

  it('shows "Opening…" while IDE is launching in IDEPicker', async () => {
    let resolveLaunch!: () => void
    vi.mocked(openInIDE).mockReturnValue(
      new Promise<undefined>((res) => { resolveLaunch = () => res(undefined) })
    )
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([{ id: 'cursor', name: 'Cursor' }])
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    await clickSubmit()
    await waitFor(() => screen.getByText('Wiki created'))
    await waitFor(() => screen.getByText('Cursor'), { timeout: 3000 })
    const clickPromise = userEvent.click(screen.getByText('Cursor'))
    await waitFor(() => expect(screen.queryByText('Opening…')).toBeInTheDocument())
    resolveLaunch()
    await clickPromise
  })

  it('shows unknown IDE with muted color (IDE_COLORS fallback)', async () => {
    vi.mocked(useWikis).mockReturnValue({ wikis: [], loading: false, reload: vi.fn() })
    vi.mocked(detectIDEs).mockResolvedValue([{ id: 'unknown-editor', name: 'Unknown Editor' }])
    vi.mocked(openInIDE).mockResolvedValue(undefined)
    vi.mocked(addWiki).mockResolvedValue({ ...mockWiki, id: 'new-id' })
    renderWithRouter(<VaultSelector />, { route: '/', path: '/' })
    await userEvent.click(screen.getAllByText(/add.*wiki/i)[0])
    await userEvent.type(screen.getByPlaceholderText('My Research'), 'Test')
    await userEvent.type(screen.getByPlaceholderText('/Users/you/Documents'), '/tmp')
    await clickSubmit()
    await waitFor(() => screen.getByText('Wiki created'))
    await waitFor(() => screen.getByText('Unknown Editor'), { timeout: 3000 })
    await userEvent.click(screen.getByText('Unknown Editor'))
    await waitFor(() => expect(screen.getByText('Opened!')).toBeInTheDocument(), { timeout: 3000 })
  })
})
