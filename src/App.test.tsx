import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'

// ── Heavy component mocks so routing tests stay fast ─────────────────────────

vi.mock('./components/VaultSelector', () => ({
  default: () => <div data-testid="vault-selector">VaultSelector</div>,
}))
vi.mock('./components/Layout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { default: () => <div data-testid="layout"><Outlet /></div> }
})
vi.mock('./components/WikiPage', () => ({
  default: () => <div data-testid="wiki-page">WikiPage</div>,
}))
vi.mock('./components/GraphView', () => ({
  default: () => <div data-testid="graph-view">GraphView</div>,
}))
vi.mock('./components/LogView', () => ({
  default: () => <div data-testid="log-view">LogView</div>,
}))

describe('App routing', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/')
  })

  it('renders VaultSelector at "/"', () => {
    render(<App />)
    expect(screen.getByTestId('vault-selector')).toBeInTheDocument()
  })

  it('WikiIndexRedirect redirects /wiki/:wikiId to /wiki/:wikiId/page/index', async () => {
    window.history.pushState({}, '', '/wiki/my-wiki')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('wiki-page')).toBeInTheDocument())
  })
})
