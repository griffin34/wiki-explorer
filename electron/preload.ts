/**
 * Electron preload script.
 * 
 * This runs in a sandboxed context with access to a limited set of Node.js
 * APIs. It creates a secure bridge between the renderer process (React app)
 * and the main process.
 * 
 * Currently minimal since the app communicates with the server via HTTP/WebSocket.
 * Can be extended to expose native features like:
 * - File dialogs
 * - System notifications
 * - Clipboard access
 */

import { contextBridge, ipcRenderer } from 'electron'

// Expose a minimal API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Get the API server URL (dynamic port in production)
  getApiUrl: () => ipcRenderer.invoke('get-api-url'),

  // Get AI service status (ollama, chroma, agent, overall)
  getAIStatus: () => ipcRenderer.invoke('get-ai-status'),

  // Open inbox folder in Finder/Explorer (for Outlook drag workaround)
  openInboxFolder: (wikiPath: string) => ipcRenderer.invoke('open-inbox-folder', wikiPath),
  
  // Reveal a file/folder in Finder/Explorer
  revealInFinder: (filePath: string) => ipcRenderer.invoke('reveal-in-finder', filePath),

  // IPC for future use (native dialogs, notifications, etc.)
  invoke: (channel: string, ...args: unknown[]) => {
    const allowedChannels = ['open-folder-dialog', 'show-notification', 'open-inbox-folder', 'reveal-in-finder']
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args)
    }
    throw new Error(`IPC channel not allowed: ${channel}`)
  },

  // One-way messages
  send: (channel: string, ...args: unknown[]) => {
    const allowedChannels = ['log']
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },
})

// AI service status interface
interface AIServiceStatus {
  ollama: 'starting' | 'ready' | 'unavailable'
  chroma: 'starting' | 'ready' | 'unavailable'
  agent: 'starting' | 'ready' | 'unavailable'
  overall: 'starting' | 'ready' | 'degraded' | 'unavailable'
}

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      platform: string
      isElectron: boolean
      getApiUrl: () => Promise<string>
      getAIStatus: () => Promise<AIServiceStatus>
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      /** Open the inbox folder for a wiki in Finder/Explorer */
      openInboxFolder: (wikiPath: string) => Promise<void>
      /** Reveal a file/folder in Finder/Explorer */
      revealInFinder: (filePath: string) => Promise<void>
    }
  }
}
