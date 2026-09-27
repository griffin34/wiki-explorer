import { type ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './ThemeContext'

interface RenderOptions {
  route?: string
  path?: string
}

/**
 * Render a component inside MemoryRouter + ThemeProvider.
 * Use `route` to set the current URL and `path` to match a route pattern
 * (e.g. '/wiki/:wikiId/page/*').
 */
export function renderWithRouter(
  ui: ReactElement,
  { route = '/', path = '*' }: RenderOptions = {}
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  )
}

/** Minimal fetch mock factory. */
export function mockFetch(response: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  })
}
