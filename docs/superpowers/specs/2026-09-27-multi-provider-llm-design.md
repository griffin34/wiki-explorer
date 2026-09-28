# Multi-Provider LLM Support — Design Spec

Date: 2026-09-27

## Problem / Intent

Wiki Explorer currently hard-codes Ollama as its only LLM backend for every AI
feature (semantic search RAG, wiki page generation, entity extraction,
AI-assisted page editing). Ollama is free and fully local, but some users
already pay for a cloud LLM subscription (Claude, OpenAI, xAI/Grok) and would
rather use that instead of running a local model.

Goal: let a user pick which LLM backend powers generation, with Ollama always
available as a free/local default and as an automatic fallback when a cloud
provider fails. Embeddings (used for semantic search indexing/retrieval)
always stay on Ollama's `nomic-embed-text` regardless of the chosen
generation provider — Anthropic, OpenAI, and xAI's chat APIs don't change
this; embeddings are a separate concern from text generation, and Claude in
particular has no public embeddings endpoint at all.

**In scope (this pass):** Ollama (existing/default), Claude (Anthropic),
OpenAI, xAI (Grok). OpenAI and xAI share one adapter, since xAI's API is
documented as OpenAI-SDK-compatible (same wire format, different base URL).

**Explicitly out of scope (for now):** GitHub Copilot. Copilot has no public
bring-your-own-key chat completions API — its chat backend is only meant to
be consumed through GitHub's own IDE extensions / Copilot Extensions
framework (typically an OAuth device-flow token against an internal,
undocumented endpoint). Building against it risks breaking silently or
running against GitHub's terms of service for a third-party tool like this.
The provider registry (below) is designed so a Copilot adapter — or any other
future provider — can be added later as just another registry entry, without
touching the router or call sites, if a legitimate integration path becomes
available.

## Current State (verified in code)

Every AI call site currently depends on a single `OllamaService`
(`agents/services/ollama_service.py`) with exactly two methods:
`generate(prompt, system=None) -> str` and `embed(text, max_chars=3000) -> list[float]`.
It's constructed once in `agents/main.py` (`ollama_svc = OllamaService()`) and
injected into `IngestionAgent`, `SearchAgent`, `WikiAgent`, and `EditAgent`.
Call sites:

- `agents/agents/ingestion.py` — `embed()` only, for chunk indexing
- `agents/agents/search.py` — `embed()` for the query, `generate()` for the RAG answer
- `agents/agents/wiki.py` — `generate()` for entity extraction + page generation
- `agents/agents/edit.py` — `embed()` for term search, `generate()` for edit content
- `agents/main.py` — `generate()` directly in two endpoint handlers

This narrow, uniform interface is why the abstraction below is a thin swap,
not a rewrite: every call site keeps calling `.generate(...)` / `.embed(...)`
on whatever object it holds; only the type of that object changes.

## Architecture

```
agents/services/
├── ollama_service.py            (unchanged — always does embeddings; local generate)
├── llm_providers/
│   ├── base.py                  # TextGenerator protocol, ProviderError / AuthConfigError / TransientProviderError
│   ├── anthropic_provider.py    # Claude, via the `anthropic` SDK
│   ├── openai_compatible.py     # shared adapter for OpenAI + xAI (`openai` SDK, configurable base_url)
│   └── registry.py              # PROVIDERS = {"ollama": ..., "anthropic": ..., "openai": ..., "xai": ...}
├── llm_router.py                 # the one object every agent holds
└── ai_settings_service.py        # reads/writes data/ai-settings.json
```

### `TextGenerator` protocol

```python
class TextGenerator(Protocol):
    async def generate(self, prompt: str, system: str | None = None) -> str: ...
```

`OllamaService` already satisfies this shape (no changes needed to it).
`AnthropicService` and `OpenAICompatibleService` implement it as thin
wrappers around their respective SDK's chat/messages call, extracting the
text response.

Each provider adapter also exposes one extra method **outside** the
`TextGenerator` protocol, used only by Settings (not by the agents that do
generation/search/editing):

```python
async def list_models(api_key: str) -> list[str]: ...
```

This calls the provider's live `models.list()` endpoint — all three cloud
SDKs support this (confirmed: Anthropic's `client.models.list()`, OpenAI's
`client.models.list()`, and xAI inherits it via OpenAI-compatibility). No
model IDs are hard-coded anywhere in the app. Ollama's own generation model
is unaffected by any of this — it stays governed by the existing
`OLLAMA_MODEL` setting in `agents/config.py`/`.env`, untouched by this
feature; `list_models()` is only ever called for the three cloud providers.

### Error taxonomy (shared across adapters)

```python
class ProviderError(Exception): ...
class AuthConfigError(ProviderError): ...      # bad/missing key — never auto-fallback
class TransientProviderError(ProviderError): ...  # rate limit, 5xx, network — fallback-eligible
```

Each adapter maps its SDK's typed exceptions into these two buckets:
- `AuthenticationError`, `PermissionDeniedError`, `NotFoundError` (bad model name) → `AuthConfigError`
- `RateLimitError`, `APIStatusError` (5xx), `APIConnectionError`, timeouts → `TransientProviderError`

This lets `LLMRouter` reason about fallback eligibility without knowing
which SDK raised what.

### `LLMRouter`

```python
class LLMRouter:
    def __init__(self, ollama: OllamaService):
        self._ollama = ollama
        self._active_id = "ollama"
        self._active: TextGenerator = ollama
        self._auto_fallback = True

    def configure(self, provider_id: str, generator: TextGenerator | None, auto_fallback: bool) -> None:
        """Called at startup and whenever Settings changes."""
        self._active_id = provider_id
        self._active = generator or self._ollama
        self._auto_fallback = auto_fallback

    async def generate(self, prompt: str, system: str | None = None) -> str:
        if self._active_id == "ollama":
            return await self._ollama.generate(prompt, system=system)
        try:
            return await self._active.generate(prompt, system=system)
        except AuthConfigError:
            raise  # surface clearly — never silently degrade on a bad/missing key
        except TransientProviderError:
            if self._auto_fallback:
                await notify_fallback(self._active_id)  # -> POST /api/ai/notify -> WS -> AIToast
                return await self._ollama.generate(prompt, system=system)
            raise

    async def embed(self, text: str, max_chars: int = 3000) -> list[float]:
        return await self._ollama.embed(text, max_chars=max_chars)  # always local
```

`agents/main.py`, `search.py`, `wiki.py`, `edit.py`, `ingestion.py` each
change one line: they're constructed with an `LLMRouter` instance instead of
an `OllamaService` instance. No other code in those files changes.

## Settings & the API key lifecycle

### Non-secret settings — `data/ai-settings.json`

Same directory/pattern as the existing `data/vaults.json`.

```json
{
  "activeProvider": "ollama",
  "autoFallbackToOllama": true,
  "providers": {
    "anthropic": { "model": "claude-sonnet-5" },
    "openai": { "model": "gpt-5" },
    "xai": { "model": "grok-4" }
  }
}
```

No API keys in this file. If the file is absent, defaults are
`activeProvider: "ollama"` — every existing install keeps behaving exactly as
it does today until a user opens Settings and opts into a cloud provider.

Read/written by `ai_settings_service.py`, exposed via new agent endpoints:
- `GET /settings` — current non-secret settings + whether a key is currently set per provider (never the key itself)
- `POST /settings` — update active provider / model / fallback toggle, and (session-only) set/clear an in-memory API key for a provider
- `GET /providers/:id/models` — call that provider's `list_models()` using its currently-set key

**A provider can only become `activeProvider` after its key has passed a
successful `list_models()` call.** This isn't a separate validation step —
it's the same call Settings already makes to populate the model dropdown, so
"fetch models" doubles as "confirm this key actually works" for free. This
removes an otherwise-ambiguous state: an active cloud provider that was
never actually authenticated. The `AuthConfigError`-surfaces-clearly rule
below is therefore specifically about a *previously validated* key going bad
later (revoked, expired) — not about a key that was never entered.

Express proxies these the same way it already proxies `/api/ai/*` routes to
the agent (`GET/PUT /api/ai/settings`, `GET /api/ai/providers/:id/models`).

### Secret API keys — Electron-owned

`electron/main.ts` already spawns `agentProcess` directly (confirmed in
code, not a detached process Express talks to some other way), which makes
Electron the natural place to hold secrets:

1. Settings UI collects an API key for a provider and sends it to Electron
   via a preload IPC call — **not** through Express, since Express is a
   separate Node process with no access to Electron's `safeStorage`.
2. Electron encrypts it with `safeStorage.encryptString()` and persists the
   ciphertext keyed by provider id to a local file, e.g. `data/.secrets.enc`
   (gitignored).
3. Electron decrypts in-memory and calls the agent's `POST /settings` with
   the plaintext key for that provider — the router updates live, no agent
   restart needed. It also injects the same value as an env var
   (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY`) into `agentEnv`
   so a freshly-spawned agent process picks it up automatically too.

This protects the key at rest (on-disk, encrypted via the OS keychain/DPAPI)
while accepting that the co-located, trusted Python agent process holds it
in memory during runtime — a standard posture for desktop apps handing a
secret to a local helper process.

### Non-Electron dev mode (`scripts/start-ai.sh`)

No `safeStorage` exists outside an Electron process. Fallback: set
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` directly in
`agents/.env`, exactly like today's `OLLAMA_BASE_URL` convention. The in-app
Settings UI still works for the current session in dev mode (it can call the
agent's `/settings` endpoint directly, held in memory only) — it just won't
persist across a restart without either `.env` or Electron's encrypted
store.

## Fallback signaling & status UI

**Fallback signaling** reuses existing plumbing rather than inventing new
UI. The agent already pushes real-time events to Express via
`POST /api/ai/notify`, broadcast over the existing WebSocket to
`AIToast.tsx`. A fallback (cloud provider call failed transiently, router
fell through to Ollama) emits an `ai:fallback` event the same way ingestion
events do today — `AIToast` gets one more event type to render.

**Status/health indicator** — `electron/main.ts` already tracks an
`aiStatus` object (`ollama: 'starting' | 'ready' | 'unavailable'`) feeding
the existing service-status UI. This extends to also report the active
cloud provider's configured/reachable state (e.g. "Claude: ready" /
"OpenAI: no key set") — richer status object, same UI component.

## Testing

Matching existing conventions (100% coverage enforced via
`vitest.config.ts`; `agents/pytest.ini` for the Python side):

- `LLMRouter` branching (success / `AuthConfigError` / `TransientProviderError`
  × fallback-on/off) — unit tests with mocked adapters, no live network calls
- Each adapter (`anthropic_provider.py`, `openai_compatible.py`) — tests
  against mocked SDK responses
- Settings UI component tests (provider switch, model-fetch-on-key-entry,
  save/error states)
- Express proxy routes (`/api/ai/settings`, `/api/ai/providers/:id/models`)
  — matching `server/index.test.ts`'s existing supertest style

`agents/evals/*` keep targeting Ollama only for now — they're
reproducibility/cost-controlled fixtures, not something that needs
multi-provider support yet.

## Documentation updates required

This is a first-class deliverable of the implementation, not an
afterthought:

- **`docs/TECHNICAL.md`** — add the provider registry to the architecture
  overview and directory structure sections; document `LLMRouter`, the
  error taxonomy, and the settings/key-lifecycle flow (mirroring how
  `OllamaService` is documented today).
- **`docs/USER-GUIDE.md`** — document the new Settings panel: how to pick a
  provider, where to get/paste an API key for each, what the auto-fallback
  toggle does, and the dev-mode `.env` fallback path.
- **`docs/API.md`** — document the new endpoints: `GET/PUT /api/ai/settings`,
  `GET /api/ai/providers/:id/models`, and the new `ai:fallback` WebSocket
  event.
- **`README.md`** — update the "Tech Stack" / "AI" line, which currently
  reads "Ollama (qwen3:8b), ChromaDB, nomic-embed-text," to reflect that
  generation is now pluggable (Ollama / Claude / OpenAI / xAI) while
  ChromaDB + nomic-embed-text remain fixed.

## New dependencies

- `anthropic` (Python) — Claude adapter
- `openai` (Python) — OpenAI + xAI adapter (xAI via `base_url` override)

Both added to `agents/requirements.txt`.

## Rollout / migration

No data migration needed. Missing `data/ai-settings.json` defaults to
`activeProvider: "ollama"`, so existing installs are unaffected until a user
opts in via the new Settings panel.
