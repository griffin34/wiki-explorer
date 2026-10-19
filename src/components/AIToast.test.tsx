import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import AIToast from './AIToast'

interface MockWebSocketLike {
  onmessage: ((e: { data: string }) => void) | null
}

function dispatchWsEvent(event: unknown) {
  const ws = (globalThis as unknown as { WebSocket: { lastInstance: MockWebSocketLike } }).WebSocket
    .lastInstance
  ws.onmessage?.({ data: JSON.stringify(event) })
}

function renderToast() {
  return render(
    <MemoryRouter>
      <AIToast />
    </MemoryRouter>
  )
}

describe('AIToast', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = renderToast()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a fallback toast when the active provider falls back to Ollama', async () => {
    renderToast()

    dispatchWsEvent({ event: 'ai:fallback', data: { provider: 'anthropic' } })

    expect(await screen.findByText('Switched to Ollama')).toBeInTheDocument()
    expect(
      screen.getByText(/claude \(anthropic\) was unavailable — fell back to ollama/i)
    ).toBeInTheDocument()
  })

  it('shows a distinct fallback toast per provider', async () => {
    renderToast()

    dispatchWsEvent({ event: 'ai:fallback', data: { provider: 'openai' } })

    await waitFor(() => {
      expect(screen.getByText(/openai was unavailable/i)).toBeInTheDocument()
    })
  })

  it('dismisses a fallback toast when its close button is clicked', async () => {
    renderToast()
    dispatchWsEvent({ event: 'ai:fallback', data: { provider: 'anthropic' } })
    const toastText = await screen.findByText('Switched to Ollama')
    const toastEl = toastText.closest('div[class*="animate-slide-in"]') as HTMLElement
    const dismissButton = toastEl.querySelector('button') as HTMLButtonElement

    dismissButton.click()

    await waitFor(() => {
      expect(screen.queryByText('Switched to Ollama')).not.toBeInTheDocument()
    })
  })
})
