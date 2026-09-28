import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
import AISettingsPanel from './AISettingsPanel'

const mockSettingsResponse = {
  active_provider: 'ollama',
  auto_fallback_to_ollama: true,
  providers: {},
  keys_configured: { anthropic: false, openai: false, xai: false },
}

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/ai/settings')) {
      return Promise.resolve({ ok: true, json: async () => mockSettingsResponse } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
})

test('renders nothing when closed', () => {
  const { container } = render(<AISettingsPanel isOpen={false} onClose={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})

test('loads and displays the current active provider', async () => {
  render(<AISettingsPanel isOpen={true} onClose={() => {}} />)

  await waitFor(() => {
    expect(screen.getByDisplayValue('Ollama (local)')).toBeInTheDocument()
  })
})

test('selecting a cloud provider reveals the API key field', async () => {
  render(<AISettingsPanel isOpen={true} onClose={() => {}} />)
  await waitFor(() => screen.getByLabelText(/provider/i))

  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } })

  expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
})

test('fetching models stages the key via the key endpoint and populates the model dropdown, without touching PUT /api/ai/settings', async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/ai/providers/anthropic/key')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    }
    if (url.includes('/api/ai/providers/anthropic/models')) {
      return Promise.resolve({ ok: true, json: async () => ['claude-opus-5', 'claude-sonnet-5'] } as Response)
    }
    if (url.includes('/api/ai/settings')) {
      return Promise.resolve({ ok: true, json: async () => mockSettingsResponse } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  global.fetch = fetchMock
  render(<AISettingsPanel isOpen={true} onClose={() => {}} />)
  await waitFor(() => screen.getByLabelText(/provider/i))
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } })
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-test' } })

  fireEvent.click(screen.getByRole('button', { name: /fetch models/i }))

  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'claude-sonnet-5' })).toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()

  // The key-staging call happened...
  const keyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/ai/providers/anthropic/key'))
  expect(keyCall).toBeTruthy()
  expect(keyCall![1]).toMatchObject({ method: 'PUT' })
  expect(JSON.parse(keyCall![1].body)).toEqual({ api_key: 'sk-test' })

  // ...but PUT /api/ai/settings was never called (only the initial GET on load).
  const settingsPutCall = fetchMock.mock.calls.find(
    ([url, options]) => String(url).includes('/api/ai/settings') && options?.method === 'PUT'
  )
  expect(settingsPutCall).toBeUndefined()
})

test('handleSave is the only path that calls PUT /api/ai/settings', async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes('/api/ai/providers/anthropic/key')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    }
    if (url.includes('/api/ai/providers/anthropic/models')) {
      return Promise.resolve({ ok: true, json: async () => ['claude-sonnet-5'] } as Response)
    }
    if (url.includes('/api/ai/settings') && options?.method === 'PUT') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...mockSettingsResponse, active_provider: 'anthropic' }),
      } as Response)
    }
    if (url.includes('/api/ai/settings')) {
      return Promise.resolve({ ok: true, json: async () => mockSettingsResponse } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  global.fetch = fetchMock
  const onClose = vi.fn()
  render(<AISettingsPanel isOpen={true} onClose={onClose} />)
  await waitFor(() => screen.getByLabelText(/provider/i))
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } })
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-test' } })
  fireEvent.click(screen.getByRole('button', { name: /fetch models/i }))
  await waitFor(() => screen.getByRole('option', { name: 'claude-sonnet-5' }))

  expect(
    fetchMock.mock.calls.some(([url, options]) => String(url).includes('/api/ai/settings') && options?.method === 'PUT')
  ).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  await waitFor(() => expect(onClose).toHaveBeenCalled())

  const saveCall = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/api/ai/settings') && options?.method === 'PUT')
  expect(saveCall).toBeTruthy()
  expect(JSON.parse(saveCall![1].body)).toMatchObject({ active_provider: 'anthropic' })
})

test('shows an error when fetching models fails (invalid key)', async () => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/ai/providers/anthropic/key')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    }
    if (url.includes('/api/ai/settings')) {
      return Promise.resolve({ ok: true, json: async () => mockSettingsResponse } as Response)
    }
    if (url.includes('/api/ai/providers/anthropic/models')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'invalid key' }) } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  render(<AISettingsPanel isOpen={true} onClose={() => {}} />)
  await waitFor(() => screen.getByLabelText(/provider/i))
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } })
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-bad' } })

  fireEvent.click(screen.getByRole('button', { name: /fetch models/i }))

  await waitFor(() => {
    expect(screen.getByText(/invalid key|could not verify/i)).toBeInTheDocument()
  })
})

test('save is disabled for a cloud provider until models have been fetched', async () => {
  render(<AISettingsPanel isOpen={true} onClose={() => {}} />)
  await waitFor(() => screen.getByLabelText(/provider/i))

  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } })

  expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
})
