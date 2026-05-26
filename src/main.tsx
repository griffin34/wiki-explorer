import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/themes.css'
import './index.css'
import { ThemeProvider } from './ThemeContext'
import App from './App'

// Sync theme to DOM before first paint to avoid flash
const stored = localStorage.getItem('wiki-theme')
document.documentElement.setAttribute('data-theme', stored === 'brand' ? 'brand' : 'catppuccin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
