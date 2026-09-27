/**
 * API URL management for Electron and browser environments.
 * 
 * In development (browser or Electron dev mode), uses localhost:3001.
 * In production Electron app, gets the dynamic port from the main process.
 */

// Extend Window interface for Electron API
declare global {
  interface Window {
    electronAPI?: {
      platform: string
      isElectron: boolean
      getApiUrl: () => Promise<string>
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      openInboxFolder?: (wikiPath: string) => Promise<void>
    }
  }
}

// Default API base for dev mode
let apiBase = 'http://localhost:3001'
let initialized = false

/**
 * Initialize the API base URL.
 * In Electron production, this fetches the dynamic port from the main process.
 */
export async function initApiBase(): Promise<void> {
  if (initialized) return
  
  console.log('[API] Initializing API base URL...')
  console.log('[API] electronAPI available:', !!window.electronAPI)
  console.log('[API] isElectron:', window.electronAPI?.isElectron)
  
  if (window.electronAPI?.isElectron) {
    try {
      const url = await window.electronAPI.getApiUrl()
      if (url) {
        apiBase = url
        console.log('[API] Using Electron API URL:', apiBase)
      } else {
        console.warn('[API] getApiUrl returned empty, using default')
      }
    } catch (err) {
      console.warn('[API] Failed to get API URL from Electron, using default:', err)
    }
  } else {
    console.log('[API] Not in Electron, using default API URL:', apiBase)
  }
  
  initialized = true
}

/**
 * Get the full URL for an API path.
 * @param path API path starting with /api/
 */
export function api(path: string): string {
  return `${apiBase}${path}`
}

/**
 * Get the WebSocket URL for a path.
 * @param path WebSocket path starting with /
 */
export function wsUrl(path: string): string {
  const wsBase = apiBase.replace(/^http/, 'ws')
  return `${wsBase}${path}`
}
