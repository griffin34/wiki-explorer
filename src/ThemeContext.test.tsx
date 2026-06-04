import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from './ThemeContext'

function ThemeDisplay() {
  const { theme, setTheme, toggleTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('brand')}>set brand</button>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to catppuccin when nothing is stored', () => {
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('catppuccin')
  })

  it('reads stored theme from localStorage', () => {
    localStorage.setItem('wiki-theme', 'brand')
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('brand')
  })

  it('falls back to catppuccin for unknown stored values', () => {
    localStorage.setItem('wiki-theme', 'unknown')
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('catppuccin')
  })

  it('setTheme changes the theme', async () => {
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    await userEvent.click(screen.getByText('set brand'))
    expect(screen.getByTestId('theme').textContent).toBe('brand')
  })

  it('toggleTheme switches catppuccin → brand → catppuccin', async () => {
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    await userEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('theme').textContent).toBe('brand')
    await userEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('theme').textContent).toBe('catppuccin')
  })

  it('persists the theme to localStorage on change', async () => {
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    await userEvent.click(screen.getByText('set brand'))
    expect(localStorage.getItem('wiki-theme')).toBe('brand')
  })

  it('applies data-theme attribute to documentElement', async () => {
    render(<ThemeProvider><ThemeDisplay /></ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe('catppuccin')
    await userEvent.click(screen.getByText('set brand'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('brand')
  })
})

describe('useTheme — default context values', () => {
  it('returns the default context without a provider', () => {
    function Bare() {
      const { theme } = useTheme()
      return <span>{theme}</span>
    }
    render(<Bare />)
    // Default context value
    expect(screen.getByText('catppuccin')).toBeInTheDocument()
  })

  it('default setTheme and toggleTheme are no-ops', async () => {
    function Bare() {
      const { setTheme, toggleTheme } = useTheme()
      return (
        <div>
          <button onClick={() => setTheme('brand')}>setTheme</button>
          <button onClick={toggleTheme}>toggle</button>
        </div>
      )
    }
    render(<Bare />)
    await userEvent.click(screen.getByText('setTheme'))
    await userEvent.click(screen.getByText('toggle'))
    // Default no-ops: no crash = success
  })
})
