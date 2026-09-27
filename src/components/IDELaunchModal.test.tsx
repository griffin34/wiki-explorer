import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IDELaunchModal, { writeToClipboard, IDE_CREATE_COMMANDS } from './IDELaunchModal'

// Mock the hooks/useWiki module
vi.mock('../hooks/useWiki', () => ({
  detectIDEs: vi.fn(),
  openInIDE: vi.fn(),
  useWikiSocket: vi.fn(),
}))
import { detectIDEs, openInIDE } from '../hooks/useWiki'

const mockIDEs = [
  { id: 'cursor', name: 'Cursor' },
  { id: 'vscode', name: 'VS Code' },
]

describe('writeToClipboard', () => {
  it('uses navigator.clipboard.writeText when available', async () => {
    await writeToClipboard('hello')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when clipboard API throws', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true)
    await writeToClipboard('fallback text')
    expect(execSpy).toHaveBeenCalledWith('copy')
    execSpy.mockRestore()
  })
})

describe('IDE_CREATE_COMMANDS', () => {
  it('has an entry for each supported IDE', () => {
    expect(IDE_CREATE_COMMANDS.cursor).toBe('create my wiki')
    expect(IDE_CREATE_COMMANDS.vscode).toBeDefined()
  })
})

describe('IDELaunchModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.mocked(detectIDEs).mockResolvedValue(mockIDEs)
    vi.mocked(openInIDE).mockResolvedValue(undefined)
  })

  it('shows a loading spinner while detecting IDEs', () => {
    vi.mocked(detectIDEs).mockReturnValue(new Promise(() => {})) // never resolves
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    expect(screen.getByText(/detecting/i)).toBeInTheDocument()
  })

  it('shows "no editors detected" when list is empty', async () => {
    vi.mocked(detectIDEs).mockResolvedValue([])
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText(/no supported editors/i)).toBeInTheDocument())
  })

  it('renders IDE buttons after loading', async () => {
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Cursor')).toBeInTheDocument())
    expect(screen.getByText('VS Code')).toBeInTheDocument()
  })

  it('uses the default title when none is provided', async () => {
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Open in editor')).toBeInTheDocument())
  })

  it('displays a custom title', async () => {
    render(<IDELaunchModal wikiPath="/tmp/wiki" title="Launch IDE" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Launch IDE')).toBeInTheDocument())
  })

  it('pre-copies the fixedCommand on mount', async () => {
    render(<IDELaunchModal wikiPath="/tmp/wiki" fixedCommand="/my-cmd" onClose={onClose} />)
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/my-cmd'))
    expect(screen.getByText('/my-cmd')).toBeInTheDocument()
  })

  it('silently ignores clipboard failure when copying fixedCommand', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    render(<IDELaunchModal wikiPath="/tmp/wiki" fixedCommand="/my-cmd" onClose={onClose} />)
    // The .catch(() => {}) swallows the error — no crash = success
    await waitFor(() => expect(screen.getByText('/my-cmd')).toBeInTheDocument())
  })

  it('clicking an IDE copies the command and calls openInIDE', async () => {
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => screen.getByText('Cursor'))
    await userEvent.click(screen.getByText('Cursor'))
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    expect(openInIDE).toHaveBeenCalledWith('cursor', '/tmp/wiki')
    await waitFor(() => expect(screen.getByText('Done!')).toBeInTheDocument())
  })

  it('commandMap overrides the per-IDE command', async () => {
    render(
      <IDELaunchModal
        wikiPath="/tmp/wiki"
        commandMap={{ cursor: '/custom-cmd' }}
        onClose={onClose}
      />
    )
    await waitFor(() => screen.getByText('Cursor'))
    await userEvent.click(screen.getByText('Cursor'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/custom-cmd')
  })

  it('closes when the X button is clicked', async () => {
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => screen.getByText('Cursor'))
    await userEvent.click(screen.getByRole('button', { name: '' })) // X button (no label)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the backdrop is clicked', async () => {
    const { container } = render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => screen.getByText('Cursor'))
    const backdrop = container.firstElementChild as HTMLElement
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('handles openInIDE errors gracefully', async () => {
    vi.mocked(openInIDE).mockRejectedValue(new Error('launch failed'))
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => screen.getByText('Cursor'))
    await userEvent.click(screen.getByText('Cursor'))
    // Should not throw; "Done!" still shows after error
    await waitFor(() => expect(screen.getByText('Done!')).toBeInTheDocument())
  })

  it('shows "Focusing…" while openInIDE is in flight', async () => {
    let resolveLaunch!: () => void
    vi.mocked(openInIDE).mockReturnValue(
      new Promise<undefined>((res) => { resolveLaunch = () => res(undefined) })
    )
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => screen.getByText('Cursor'))
    // Start the click but don't await — we want to inspect intermediate state
    const clickPromise = userEvent.click(screen.getByText('Cursor'))
    await waitFor(() => expect(screen.queryByText('Focusing…')).toBeInTheDocument())
    resolveLaunch()
    await clickPromise
    await waitFor(() => expect(screen.getByText('Done!')).toBeInTheDocument())
  })

  it('falls back to /create-wiki command for unknown IDE id', async () => {
    vi.mocked(detectIDEs).mockResolvedValue([{ id: 'unknown-editor', name: 'Unknown Editor' }])
    render(<IDELaunchModal wikiPath="/tmp/wiki" onClose={onClose} />)
    await waitFor(() => screen.getByText('Unknown Editor'))
    await userEvent.click(screen.getByText('Unknown Editor'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/create-wiki')
    await waitFor(() => expect(screen.getByText('Done!')).toBeInTheDocument())
  })
})
