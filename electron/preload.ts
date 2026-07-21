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

  // IPC for future use (native dialogs, notifications, etc.)
  invoke: (channel: string, ...args: unknown[]) => {
    const allowedChannels = ['open-folder-dialog', 'show-notification']
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

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI?: {
      platform: string
      isElectron: boolean
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
    }
  }
}
