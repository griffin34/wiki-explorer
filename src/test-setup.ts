import '@testing-library/jest-dom/vitest'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Clean up after each test
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── Stable mock WebSocket so useWikiSocket doesn't reconnect endlessly ─────────
class MockWebSocket {
  static OPEN = 1
  static lastInstance: MockWebSocket | null = null
  readyState = MockWebSocket.OPEN
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { MockWebSocket.lastInstance = this }
  close() {}
  send() {}
}
vi.stubGlobal('WebSocket', MockWebSocket)

// ── Mock dynamic CSS imports (rehype-highlight theme switching in WikiPage) ─────
vi.mock('highlight.js/styles/github.css', () => ({}))
vi.mock('highlight.js/styles/tokyo-night-dark.css', () => ({}))

// ── Navigator clipboard stub ─────────────────────────────────────────────────
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
})

// ── document.execCommand stub (not available in happy-dom) ───────────────────
if (typeof document.execCommand !== 'function') {
  document.execCommand = vi.fn().mockReturnValue(true)
}
