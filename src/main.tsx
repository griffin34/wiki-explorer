/* v8 ignore file */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/themes.css'
import './index.css'
import { ThemeProvider } from './ThemeContext'
import App from './App'
import { initApiBase, api } from './utils/api'

// Sync theme to DOM before first paint to avoid flash
const stored = localStorage.getItem('wiki-theme')
document.documentElement.setAttribute('data-theme', stored === 'brand' ? 'brand' : 'catppuccin')

// Show loading state immediately
const rootEl = document.getElementById('root')!
rootEl.innerHTML = '<div style="color: white; padding: 20px; text-align: center;"><div>Loading Wiki Explorer...</div><div style="font-size: 12px; color: #6c7086; margin-top: 8px;">Waiting for server...</div></div>'

console.log('[Main] Starting app initialization...')

// Wait for API to be reachable before rendering
async function waitForApi(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(api('/api/wikis'))
      if (response.ok) {
        console.log(`[Main] API ready after ${i + 1} attempts`)
        return true
      }
    } catch {
      // API not ready yet
    }
    await new Promise(r => setTimeout(r, 500))
    if (i % 5 === 0) {
      console.log(`[Main] Waiting for API... (attempt ${i + 1}/${maxAttempts})`)
    }
  }
  return false
}

// Initialize API base URL (async for Electron), then render
initApiBase()
  .then(async () => {
    console.log('[Main] API base initialized, waiting for server...')
    
    // Wait for server to be ready
    const apiReady = await waitForApi()
    if (!apiReady) {
      console.warn('[Main] API not ready after timeout, rendering anyway')
    }
    
    console.log('[Main] Rendering React app...')
    try {
      const root = createRoot(rootEl)
      root.render(
        <StrictMode>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </StrictMode>
      )
      console.log('[Main] React render called')
    } catch (err) {
      console.error('[Main] React render error:', err)
      rootEl.innerHTML = `<div style="color: red; padding: 20px;">Render Error: ${err}</div>`
    }
  })
  .catch((err) => {
    console.error('[Main] Init error:', err)
    rootEl.innerHTML = `<div style="color: red; padding: 20px;">Init Error: ${err.message}</div>`
  })
