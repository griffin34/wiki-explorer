# Multi-Provider LLM Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user choose which LLM powers Wiki Explorer's generation features (Ollama / Claude / OpenAI / xAI), with Ollama always used for embeddings and always available as an automatic fallback.

**Architecture:** A `TextGenerator` protocol with three implementations (Ollama, existing; Anthropic; OpenAI-compatible for both OpenAI and xAI) sit behind one `LLMRouter` that every agent already calls `.generate()`/`.embed()` on. Settings (active provider, model, fallback toggle) persist in a new `data/ai-settings.json`; API keys are held in-memory by the agent process and, when running under Electron, encrypted at rest via `safeStorage` and injected as env vars.

**Tech Stack:** Python (FastAPI, pydantic, `anthropic` SDK, `openai` SDK), TypeScript (Express, React), Electron (`safeStorage`, `child_process`).

**Spec:** [docs/superpowers/specs/2026-09-27-multi-provider-llm-design.md](../specs/2026-09-27-multi-provider-llm-design.md)

## Global Constraints

- Embeddings always go through `OllamaService` — no provider choice affects `.embed()`, ever.
- No model IDs are hard-coded for cloud providers — model lists come from each provider's live `models.list()`/`list_models()` call.
- A provider can only become `active_provider` in settings after its key has passed a `list_models()` call (this doubles as key validation).
- Auth/config errors (bad or revoked key) never trigger silent fallback — they raise and must be surfaced to the user. Only transient errors (rate limit, 5xx, network) are fallback-eligible, and only when the fallback toggle is on.
- Default settings (`data/ai-settings.json` absent) = `active_provider: "ollama"` — zero behavior change for existing installs until a user opts in.
- `agents/evals/*` are out of scope — they keep targeting Ollama only.
- No GitHub Copilot adapter in this pass.

## Review Focus

- **A provider is set active in `ai-settings.json` but this process has no key for it in memory** (e.g. the agent restarts in dev mode without the matching env var set, even though a previous Electron session saved `active_provider: "anthropic"`) — must not silently use Ollama and pretend the cloud provider ran; must behave the same as a revoked key (raise `AuthConfigError`). Covered in Task 6.
- **A previously-valid key is revoked/expires mid-session** — the very next `generate()` call must raise clearly, not fall back silently, regardless of the fallback toggle. Covered in Task 4.
- **The fallback toggle is off and the active provider is down** — the original error must propagate to the caller (and ultimately to the HTTP response) rather than being swallowed. Covered in Task 4 and Task 6.
- **Two different providers' errors must map to the same two buckets** — `RateLimitError` from `anthropic` and from `openai` must both become `TransientProviderError`; `AuthenticationError` from both must become `AuthConfigError`. Covered in Tasks 2 and 3.
- **Settings file is missing or corrupt on disk** — `AISettingsService.load()` must return safe defaults (`active_provider: "ollama"`) rather than crashing agent startup. Covered in Task 5.

---

## Task 1: Python test infrastructure

**Files:**
- Modify: `agents/pytest.ini`
- Create: `agents/tests/__init__.py`
- Create: `agents/tests/conftest.py`
- Create: `agents/tests/test_wiki_slug.py`

**Interfaces:**
- Produces: a `tests/` package that pytest discovers alongside the existing `evals/` package, using the same `test_*.py` / `pytest-asyncio` conventions.

Today `pytest.ini` restricts discovery to `testpaths = evals`, so there is no unit-test suite for the Python agent code — only the (slow, quality-oriented) eval suite. This task adds a real unit-test home without touching evals.

- [ ] **Step 1: Update `pytest.ini` to discover both directories**

Modify `agents/pytest.ini`:

```diff
 [pytest]
 # Eval suite configuration
-testpaths = evals
+testpaths = evals tests
 python_files = eval_*.py test_*.py
```

- [ ] **Step 2: Create the tests package and a conftest**

Create `agents/tests/__init__.py` (empty file).

Create `agents/tests/conftest.py`:

```python
from __future__ import annotations

import sys
from pathlib import Path

# agents/main.py and friends import as `from config import settings`,
# `from services...`, `from agents...` — i.e. relative to agents/ being on
# sys.path. The existing evals/conftest.py relies on the same thing when
# pytest is run from agents/; replicate that here for tests/.
AGENTS_DIR = Path(__file__).parent.parent
if str(AGENTS_DIR) not in sys.path:
    sys.path.insert(0, str(AGENTS_DIR))
```

- [ ] **Step 3: Write a real first test to prove discovery works**

Create `agents/tests/test_wiki_slug.py`:

```python
from __future__ import annotations

from agents.wiki import _make_slug


def test_make_slug_lowercases_and_strips_spaces():
    assert _make_slug("Kara Dave") == "karadave"


def test_make_slug_strips_punctuation():
    assert _make_slug("React & Node.js!") == "reactnodejs"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `agents/`): `python -m pytest tests/ -v`
Expected: 2 passed. If pytest can't find `agents` as an importable package, confirm `agents/agents/__init__.py` exists (it does, per the existing tree) and that step 2's `conftest.py` path insertion worked.

- [ ] **Step 5: Run the full suite (evals + tests) to confirm nothing else broke**

Run (from `agents/`): `python -m pytest -v`
Expected: existing eval collection behavior unchanged, plus the 2 new tests passing.

- [ ] **Step 6: Commit**

```bash
git add agents/pytest.ini agents/tests/
git commit -m "test: add agents/tests/ unit test infrastructure"
```

---

## Task 2: Provider error taxonomy + Anthropic adapter

**Files:**
- Create: `agents/services/llm_providers/__init__.py`
- Create: `agents/services/llm_providers/base.py`
- Create: `agents/services/llm_providers/anthropic_provider.py`
- Modify: `agents/requirements.txt`
- Test: `agents/tests/test_anthropic_provider.py`

**Interfaces:**
- Produces: `TextGenerator` (Protocol), `ProviderError`, `AuthConfigError`, `TransientProviderError` (from `llm_providers.base`); `AnthropicService(api_key: str, model: str)` with `async generate(prompt: str, system: str | None = None) -> str` and `async list_models() -> list[str]` (from `llm_providers.anthropic_provider`).

- [ ] **Step 1: Add the `anthropic` dependency**

Modify `agents/requirements.txt`, append:

```
anthropic>=0.40.0
```

- [ ] **Step 2: Write the protocol and error taxonomy**

Create `agents/services/llm_providers/__init__.py` (empty file).

Create `agents/services/llm_providers/base.py`:

```python
from __future__ import annotations

from typing import Protocol


class TextGenerator(Protocol):
    async def generate(self, prompt: str, system: str | None = None) -> str: ...


class ProviderError(Exception):
    """Base class for all provider adapter errors."""


class AuthConfigError(ProviderError):
    """Bad/missing/revoked API key, or an invalid model name. Never auto-fallback."""


class TransientProviderError(ProviderError):
    """Rate limit, 5xx, network error, or timeout. Eligible for fallback."""
```

- [ ] **Step 3: Write the failing tests for the Anthropic adapter**

Create `agents/tests/test_anthropic_provider.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import anthropic
import pytest

from services.llm_providers.anthropic_provider import AnthropicService
from services.llm_providers.base import AuthConfigError, TransientProviderError


def _mock_response(text: str) -> MagicMock:
    block = MagicMock()
    block.type = "text"
    block.text = text
    response = MagicMock()
    response.content = [block]
    return response


@pytest.mark.asyncio
async def test_generate_returns_text_block():
    svc = AnthropicService(api_key="sk-test", model="claude-sonnet-5")
    svc._client.messages.create = AsyncMock(return_value=_mock_response("hello world"))

    result = await svc.generate("say hello")

    assert result == "hello world"
    svc._client.messages.create.assert_awaited_once()
    _, kwargs = svc._client.messages.create.call_args
    assert kwargs["model"] == "claude-sonnet-5"
    assert kwargs["messages"] == [{"role": "user", "content": "say hello"}]


@pytest.mark.asyncio
async def test_generate_passes_system_prompt():
    svc = AnthropicService(api_key="sk-test", model="claude-sonnet-5")
    svc._client.messages.create = AsyncMock(return_value=_mock_response("ok"))

    await svc.generate("do it", system="You are terse.")

    _, kwargs = svc._client.messages.create.call_args
    assert kwargs["system"] == "You are terse."


@pytest.mark.asyncio
async def test_generate_maps_authentication_error():
    svc = AnthropicService(api_key="sk-bad", model="claude-sonnet-5")
    svc._client.messages.create = AsyncMock(
        side_effect=anthropic.AuthenticationError(
            message="invalid x-api-key", response=MagicMock(status_code=401), body=None
        )
    )

    with pytest.raises(AuthConfigError):
        await svc.generate("hi")


@pytest.mark.asyncio
async def test_generate_maps_rate_limit_error_to_transient():
    svc = AnthropicService(api_key="sk-test", model="claude-sonnet-5")
    svc._client.messages.create = AsyncMock(
        side_effect=anthropic.RateLimitError(
            message="rate limited", response=MagicMock(status_code=429), body=None
        )
    )

    with pytest.raises(TransientProviderError):
        await svc.generate("hi")


@pytest.mark.asyncio
async def test_generate_maps_connection_error_to_transient():
    svc = AnthropicService(api_key="sk-test", model="claude-sonnet-5")
    svc._client.messages.create = AsyncMock(
        side_effect=anthropic.APIConnectionError(request=MagicMock())
    )

    with pytest.raises(TransientProviderError):
        await svc.generate("hi")


@pytest.mark.asyncio
async def test_list_models_returns_ids():
    svc = AnthropicService(api_key="sk-test", model="claude-sonnet-5")
    m1, m2 = MagicMock(id="claude-opus-5"), MagicMock(id="claude-sonnet-5")
    svc._client.models.list = AsyncMock(return_value=[m1, m2])

    result = await svc.list_models()

    assert result == ["claude-opus-5", "claude-sonnet-5"]


@pytest.mark.asyncio
async def test_list_models_maps_authentication_error():
    svc = AnthropicService(api_key="sk-bad", model="claude-sonnet-5")
    svc._client.models.list = AsyncMock(
        side_effect=anthropic.AuthenticationError(
            message="invalid x-api-key", response=MagicMock(status_code=401), body=None
        )
    )

    with pytest.raises(AuthConfigError):
        await svc.list_models()
```

- [ ] **Step 4: Run the tests to verify they fail**

Run (from `agents/`): `python -m pytest tests/test_anthropic_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.llm_providers.anthropic_provider'`

- [ ] **Step 5: Implement the Anthropic adapter**

Create `agents/services/llm_providers/anthropic_provider.py`:

```python
from __future__ import annotations

import anthropic

from .base import AuthConfigError, TransientProviderError

_MAX_TOKENS = 4096


class AnthropicService:
    """TextGenerator backed by the Claude API (Anthropic)."""

    def __init__(self, api_key: str, model: str) -> None:
        self._model = model
        self._client = anthropic.AsyncAnthropic(api_key=api_key)

    async def generate(self, prompt: str, system: str | None = None) -> str:
        kwargs: dict = {
            "model": self._model,
            "max_tokens": _MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system is not None:
            kwargs["system"] = system

        try:
            response = await self._client.messages.create(**kwargs)
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.NotFoundError) as exc:
            raise AuthConfigError(str(exc)) from exc
        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
            raise TransientProviderError(str(exc)) from exc

        for block in response.content:
            if block.type == "text":
                return block.text
        return ""

    async def list_models(self) -> list[str]:
        try:
            models = await self._client.models.list()
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            raise AuthConfigError(str(exc)) from exc
        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
            raise TransientProviderError(str(exc)) from exc
        return [m.id for m in models]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `agents/`): `python -m pytest tests/test_anthropic_provider.py -v`
Expected: 7 passed

- [ ] **Step 7: Install the new dependency in the dev environment**

Run: `pip install -r agents/requirements.txt` (or, if using the project's venv convention, `agents/.venv/bin/pip install -r agents/requirements.txt`)

- [ ] **Step 8: Commit**

```bash
git add agents/requirements.txt agents/services/llm_providers/ agents/tests/test_anthropic_provider.py
git commit -m "feat: add Anthropic (Claude) LLM provider adapter"
```

---

## Task 3: OpenAI-compatible adapter (OpenAI + xAI) and provider registry

**Files:**
- Create: `agents/services/llm_providers/openai_compatible.py`
- Create: `agents/services/llm_providers/registry.py`
- Modify: `agents/requirements.txt`
- Test: `agents/tests/test_openai_compatible.py`
- Test: `agents/tests/test_provider_registry.py`

**Interfaces:**
- Consumes: `AuthConfigError`, `TransientProviderError` from `llm_providers.base` (Task 2); `AnthropicService` from `llm_providers.anthropic_provider` (Task 2)
- Produces: `OpenAICompatibleService(api_key: str, base_url: str, model: str)` with the same `generate()`/`list_models()` shape as `AnthropicService`; `ProviderSpec` dataclass and `PROVIDER_SPECS: dict[str, ProviderSpec]` (ids: `"ollama"`, `"anthropic"`, `"openai"`, `"xai"`); `create_provider(provider_id: str, api_key: str, model: str) -> TextGenerator` (from `llm_providers.registry`)

- [ ] **Step 1: Add the `openai` dependency**

Modify `agents/requirements.txt`, append:

```
openai>=1.50.0
```

- [ ] **Step 2: Write the failing tests for the OpenAI-compatible adapter**

Create `agents/tests/test_openai_compatible.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import openai
import pytest

from services.llm_providers.base import AuthConfigError, TransientProviderError
from services.llm_providers.openai_compatible import OpenAICompatibleService


def _mock_completion(text: str) -> MagicMock:
    choice = MagicMock()
    choice.message.content = text
    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.mark.asyncio
async def test_generate_returns_message_content():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    svc._client.chat.completions.create = AsyncMock(return_value=_mock_completion("hi there"))

    result = await svc.generate("say hi")

    assert result == "hi there"
    _, kwargs = svc._client.chat.completions.create.call_args
    assert kwargs["model"] == "gpt-5"
    assert kwargs["messages"] == [{"role": "user", "content": "say hi"}]


@pytest.mark.asyncio
async def test_generate_puts_system_prompt_first():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.x.ai/v1", model="grok-4")
    svc._client.chat.completions.create = AsyncMock(return_value=_mock_completion("ok"))

    await svc.generate("do it", system="Be terse.")

    _, kwargs = svc._client.chat.completions.create.call_args
    assert kwargs["messages"] == [
        {"role": "system", "content": "Be terse."},
        {"role": "user", "content": "do it"},
    ]


@pytest.mark.asyncio
async def test_generate_maps_authentication_error():
    svc = OpenAICompatibleService(api_key="sk-bad", base_url="https://api.openai.com/v1", model="gpt-5")
    svc._client.chat.completions.create = AsyncMock(
        side_effect=openai.AuthenticationError(message="bad key", response=MagicMock(status_code=401), body=None)
    )

    with pytest.raises(AuthConfigError):
        await svc.generate("hi")


@pytest.mark.asyncio
async def test_generate_maps_rate_limit_to_transient():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    svc._client.chat.completions.create = AsyncMock(
        side_effect=openai.RateLimitError(message="slow down", response=MagicMock(status_code=429), body=None)
    )

    with pytest.raises(TransientProviderError):
        await svc.generate("hi")


@pytest.mark.asyncio
async def test_list_models_returns_ids():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    page = MagicMock()
    page.data = [MagicMock(id="gpt-5"), MagicMock(id="gpt-5-mini")]
    svc._client.models.list = AsyncMock(return_value=page)

    result = await svc.list_models()

    assert result == ["gpt-5", "gpt-5-mini"]
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_openai_compatible.py -v`
Expected: FAIL — module not found

- [ ] **Step 4: Implement the OpenAI-compatible adapter**

Create `agents/services/llm_providers/openai_compatible.py`:

```python
from __future__ import annotations

import openai

from .base import AuthConfigError, TransientProviderError


class OpenAICompatibleService:
    """TextGenerator backed by any OpenAI-Chat-Completions-compatible API.

    Used for both OpenAI (base_url=https://api.openai.com/v1) and xAI/Grok
    (base_url=https://api.x.ai/v1) — xAI documents its API as a drop-in
    replacement for the OpenAI SDK with a different base_url.
    """

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self._model = model
        self._client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def generate(self, prompt: str, system: str | None = None) -> str:
        messages: list[dict] = []
        if system is not None:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
            )
        except (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError) as exc:
            raise AuthConfigError(str(exc)) from exc
        except (openai.RateLimitError, openai.APIConnectionError, openai.APIStatusError) as exc:
            raise TransientProviderError(str(exc)) from exc

        return response.choices[0].message.content or ""

    async def list_models(self) -> list[str]:
        try:
            page = await self._client.models.list()
        except (openai.AuthenticationError, openai.PermissionDeniedError) as exc:
            raise AuthConfigError(str(exc)) from exc
        except (openai.RateLimitError, openai.APIConnectionError, openai.APIStatusError) as exc:
            raise TransientProviderError(str(exc)) from exc
        return [m.id for m in page.data]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_openai_compatible.py -v`
Expected: 5 passed

- [ ] **Step 6: Write the failing test for the provider registry**

Create `agents/tests/test_provider_registry.py`:

```python
from __future__ import annotations

import pytest

from services.llm_providers.anthropic_provider import AnthropicService
from services.llm_providers.openai_compatible import OpenAICompatibleService
from services.llm_providers.registry import PROVIDER_SPECS, create_provider


def test_registry_lists_all_four_providers():
    assert set(PROVIDER_SPECS.keys()) == {"ollama", "anthropic", "openai", "xai"}


def test_ollama_needs_no_api_key():
    assert PROVIDER_SPECS["ollama"].needs_api_key is False


def test_cloud_providers_need_api_key():
    for provider_id in ("anthropic", "openai", "xai"):
        assert PROVIDER_SPECS[provider_id].needs_api_key is True


def test_create_provider_anthropic():
    provider = create_provider("anthropic", api_key="sk-test", model="claude-sonnet-5")
    assert isinstance(provider, AnthropicService)


def test_create_provider_openai_uses_openai_base_url():
    provider = create_provider("openai", api_key="sk-test", model="gpt-5")
    assert isinstance(provider, OpenAICompatibleService)
    assert provider._client.base_url.host == "api.openai.com"


def test_create_provider_xai_uses_xai_base_url():
    provider = create_provider("xai", api_key="sk-test", model="grok-4")
    assert isinstance(provider, OpenAICompatibleService)
    assert provider._client.base_url.host == "api.x.ai"


def test_create_provider_rejects_ollama():
    with pytest.raises(ValueError):
        create_provider("ollama", api_key="", model="")


def test_create_provider_rejects_unknown():
    with pytest.raises(ValueError):
        create_provider("copilot", api_key="x", model="x")
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `python -m pytest tests/test_provider_registry.py -v`
Expected: FAIL — module not found

- [ ] **Step 8: Implement the registry**

Create `agents/services/llm_providers/registry.py`:

```python
from __future__ import annotations

from dataclasses import dataclass

from .anthropic_provider import AnthropicService
from .base import TextGenerator
from .openai_compatible import OpenAICompatibleService


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    display_name: str
    needs_api_key: bool
    base_url: str | None = None


PROVIDER_SPECS: dict[str, ProviderSpec] = {
    "ollama": ProviderSpec(id="ollama", display_name="Ollama (local)", needs_api_key=False),
    "anthropic": ProviderSpec(id="anthropic", display_name="Claude (Anthropic)", needs_api_key=True),
    "openai": ProviderSpec(
        id="openai", display_name="OpenAI", needs_api_key=True, base_url="https://api.openai.com/v1"
    ),
    "xai": ProviderSpec(
        id="xai", display_name="xAI (Grok)", needs_api_key=True, base_url="https://api.x.ai/v1"
    ),
}


def create_provider(provider_id: str, api_key: str, model: str) -> TextGenerator:
    """Construct a TextGenerator for a cloud provider. Never called for 'ollama' —
    the OllamaService instance is constructed separately and held by LLMRouter directly."""
    if provider_id == "anthropic":
        return AnthropicService(api_key=api_key, model=model)
    if provider_id in ("openai", "xai"):
        base_url = PROVIDER_SPECS[provider_id].base_url
        assert base_url is not None
        return OpenAICompatibleService(api_key=api_key, base_url=base_url, model=model)
    raise ValueError(f"Unknown or unsupported provider: {provider_id!r}")
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `python -m pytest tests/test_provider_registry.py -v`
Expected: 7 passed

- [ ] **Step 10: Install the new dependency**

Run: `pip install -r agents/requirements.txt`

- [ ] **Step 11: Commit**

```bash
git add agents/requirements.txt agents/services/llm_providers/openai_compatible.py \
        agents/services/llm_providers/registry.py agents/tests/test_openai_compatible.py \
        agents/tests/test_provider_registry.py
git commit -m "feat: add OpenAI/xAI provider adapter and provider registry"
```

---

## Task 4: LLMRouter

**Files:**
- Create: `agents/services/llm_router.py`
- Test: `agents/tests/test_llm_router.py`

**Interfaces:**
- Consumes: `OllamaService` (existing, `generate`/`embed`); `TextGenerator`, `AuthConfigError`, `TransientProviderError` from `llm_providers.base`
- Produces: `LLMRouter(ollama: OllamaService)` with `configure(provider_id: str, generator: TextGenerator | None, auto_fallback: bool) -> None`, `async generate(prompt: str, system: str | None = None) -> str`, `async embed(text: str, max_chars: int = 3000) -> list[float]`, and a read-only `active_provider_id: str` property — this is what Task 6 injects into every agent in place of `OllamaService`.

- [ ] **Step 1: Write the failing tests**

Create `agents/tests/test_llm_router.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from services.llm_providers.base import AuthConfigError, TransientProviderError
from services.llm_router import LLMRouter
from services.ollama_service import OllamaService


def _router() -> tuple[LLMRouter, OllamaService]:
    ollama = OllamaService()
    ollama.generate = AsyncMock(return_value="ollama answer")
    ollama.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
    return LLMRouter(ollama), ollama


@pytest.mark.asyncio
async def test_defaults_to_ollama():
    router, ollama = _router()

    result = await router.generate("hi")

    assert result == "ollama answer"
    assert router.active_provider_id == "ollama"


@pytest.mark.asyncio
async def test_embed_always_uses_ollama_even_when_cloud_provider_active():
    router, ollama = _router()
    cloud = AsyncMock()
    cloud.generate = AsyncMock(return_value="cloud answer")
    router.configure("anthropic", cloud, auto_fallback=True)

    result = await router.embed("some text")

    assert result == [0.1, 0.2, 0.3]
    ollama.embed.assert_awaited_once_with("some text", max_chars=3000)


@pytest.mark.asyncio
async def test_uses_configured_cloud_provider_on_success():
    router, _ = _router()
    cloud = AsyncMock()
    cloud.generate = AsyncMock(return_value="cloud answer")
    router.configure("anthropic", cloud, auto_fallback=True)

    result = await router.generate("hi", system="be terse")

    assert result == "cloud answer"
    cloud.generate.assert_awaited_once_with("hi", system="be terse")
    assert router.active_provider_id == "anthropic"


@pytest.mark.asyncio
async def test_auth_config_error_never_falls_back():
    router, ollama = _router()
    cloud = AsyncMock()
    cloud.generate = AsyncMock(side_effect=AuthConfigError("bad key"))
    router.configure("anthropic", cloud, auto_fallback=True)

    with pytest.raises(AuthConfigError):
        await router.generate("hi")

    ollama.generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_transient_error_falls_back_when_enabled():
    router, ollama = _router()
    cloud = AsyncMock()
    cloud.generate = AsyncMock(side_effect=TransientProviderError("rate limited"))
    router.configure("anthropic", cloud, auto_fallback=True)

    result = await router.generate("hi")

    assert result == "ollama answer"
    ollama.generate.assert_awaited_once_with("hi", system=None)


@pytest.mark.asyncio
async def test_transient_error_raises_when_fallback_disabled():
    router, ollama = _router()
    cloud = AsyncMock()
    cloud.generate = AsyncMock(side_effect=TransientProviderError("rate limited"))
    router.configure("anthropic", cloud, auto_fallback=False)

    with pytest.raises(TransientProviderError):
        await router.generate("hi")

    ollama.generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_fallback_calls_notify_hook():
    router, _ = _router()
    cloud = AsyncMock()
    cloud.generate = AsyncMock(side_effect=TransientProviderError("rate limited"))
    router.configure("anthropic", cloud, auto_fallback=True)
    notified: list[str] = []
    router._on_fallback = AsyncMock(side_effect=lambda provider_id: notified.append(provider_id))

    await router.generate("hi")

    assert notified == ["anthropic"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_llm_router.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `LLMRouter`**

Create `agents/services/llm_router.py`:

```python
from __future__ import annotations

import logging

import httpx

from config import settings
from services.llm_providers.base import AuthConfigError, TextGenerator, TransientProviderError
from services.ollama_service import OllamaService

logger = logging.getLogger(__name__)


class LLMRouter:
    """The single generate()/embed() entry point every agent depends on.

    embed() always goes to Ollama, regardless of the active provider — no
    cloud provider here offers embeddings. generate() goes to whichever
    provider is configured active, falling back to Ollama on transient
    errors if auto_fallback is enabled. Auth/config errors are never
    silently swallowed.
    """

    def __init__(self, ollama: OllamaService) -> None:
        self._ollama = ollama
        self._active_id = "ollama"
        self._active: TextGenerator | None = None
        self._auto_fallback = True

    @property
    def active_provider_id(self) -> str:
        return self._active_id

    def configure(self, provider_id: str, generator: TextGenerator | None, auto_fallback: bool) -> None:
        self._active_id = provider_id
        self._active = generator
        self._auto_fallback = auto_fallback

    async def generate(self, prompt: str, system: str | None = None) -> str:
        if self._active_id == "ollama" or self._active is None:
            return await self._ollama.generate(prompt, system=system)

        try:
            return await self._active.generate(prompt, system=system)
        except AuthConfigError:
            raise  # never silently fall back — the user needs to fix their key
        except TransientProviderError:
            if not self._auto_fallback:
                raise
            logger.warning(
                "Provider %s failed transiently, falling back to Ollama", self._active_id
            )
            await self._on_fallback(self._active_id)
            return await self._ollama.generate(prompt, system=system)

    async def embed(self, text: str, max_chars: int = 3000) -> list[float]:
        return await self._ollama.embed(text, max_chars=max_chars)

    async def _on_fallback(self, provider_id: str) -> None:
        """Notify Express so the UI can show a fallback toast. Best-effort —
        mirrors the existing notify pattern in ingestion.py/wiki.py."""
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{settings.express_url}/api/ai/notify",
                    json={"event": "ai:fallback", "data": {"provider": provider_id}},
                    timeout=5.0,
                )
        except Exception:
            pass
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_llm_router.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add agents/services/llm_router.py agents/tests/test_llm_router.py
git commit -m "feat: add LLMRouter — the single generate()/embed() entry point"
```

---

## Task 5: AI settings persistence

**Files:**
- Modify: `agents/config.py`
- Modify: `agents/models/schemas.py`
- Create: `agents/services/ai_settings_service.py`
- Test: `agents/tests/test_ai_settings_service.py`

**Interfaces:**
- Produces: `settings.ai_settings_file: Path`, `settings.anthropic_api_key: str | None`, `settings.openai_api_key: str | None`, `settings.xai_api_key: str | None` (on the existing `Settings` singleton); `ProviderSettings(BaseModel)` with `model: str`; `AISettings(BaseModel)` with `active_provider: str`, `auto_fallback_to_ollama: bool`, `providers: dict[str, ProviderSettings]`; `AISettingsService` with `load() -> AISettings` and `save(settings: AISettings) -> None`.

- [ ] **Step 1: Add new fields to `agents/config.py`**

Modify `agents/config.py` — add after the existing `vaults_file` field/validator block (after line 34, before the `# Ingestion` comment):

```python
    # AI settings registry — non-secret provider/model choice, resolved like vaults_file
    ai_settings_file: Path = Path(__file__).parent.parent / "data" / "ai-settings.json"

    @field_validator("ai_settings_file", mode="before")
    @classmethod
    def _coerce_ai_settings_file(cls, v: object) -> Path:
        return Path(v) if v else Path(__file__).parent.parent / "data" / "ai-settings.json"

    # Cloud LLM provider API keys — set via env/.env in dev, or injected by
    # Electron (from its encrypted store) when running the packaged app.
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    xai_api_key: str | None = None
```

- [ ] **Step 2: Add the settings models to `agents/models/schemas.py`**

Modify `agents/models/schemas.py` — append at the end of the file:

```python
# AI provider settings

class ProviderSettings(BaseModel):
    model: str


class AISettings(BaseModel):
    active_provider: str = "ollama"
    auto_fallback_to_ollama: bool = True
    providers: dict[str, ProviderSettings] = {}


class AISettingsResponse(BaseModel):
    """AISettings plus which providers currently have a key set (never the keys themselves)."""
    active_provider: str
    auto_fallback_to_ollama: bool
    providers: dict[str, ProviderSettings]
    keys_configured: dict[str, bool]


class AISettingsUpdateRequest(BaseModel):
    active_provider: str
    auto_fallback_to_ollama: bool = True
    providers: dict[str, ProviderSettings] = {}
    api_key: Optional[str] = None
    """If set, updates the in-memory key for `active_provider` for this
    session (never persisted to disk by the agent itself)."""
```

- [ ] **Step 3: Write the failing tests for `AISettingsService`**

Create `agents/tests/test_ai_settings_service.py`:

```python
from __future__ import annotations

import json
from pathlib import Path

from models.schemas import AISettings, ProviderSettings
from services.ai_settings_service import AISettingsService


def test_load_returns_defaults_when_file_missing(tmp_path: Path):
    svc = AISettingsService(file_path=tmp_path / "ai-settings.json")

    result = svc.load()

    assert result == AISettings(active_provider="ollama", auto_fallback_to_ollama=True, providers={})


def test_load_returns_defaults_when_file_corrupt(tmp_path: Path):
    file_path = tmp_path / "ai-settings.json"
    file_path.write_text("{not valid json")
    svc = AISettingsService(file_path=file_path)

    result = svc.load()

    assert result.active_provider == "ollama"


def test_save_then_load_round_trips(tmp_path: Path):
    file_path = tmp_path / "ai-settings.json"
    svc = AISettingsService(file_path=file_path)
    original = AISettings(
        active_provider="anthropic",
        auto_fallback_to_ollama=False,
        providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
    )

    svc.save(original)
    result = svc.load()

    assert result == original


def test_save_creates_parent_directory(tmp_path: Path):
    file_path = tmp_path / "nested" / "dir" / "ai-settings.json"
    svc = AISettingsService(file_path=file_path)

    svc.save(AISettings())

    assert file_path.exists()
    assert json.loads(file_path.read_text())["active_provider"] == "ollama"
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `python -m pytest tests/test_ai_settings_service.py -v`
Expected: FAIL — module not found

- [ ] **Step 5: Implement `AISettingsService`**

Create `agents/services/ai_settings_service.py`:

```python
from __future__ import annotations

import logging
from pathlib import Path

from config import settings
from models.schemas import AISettings

logger = logging.getLogger(__name__)


class AISettingsService:
    def __init__(self, file_path: Path | None = None) -> None:
        self._file_path = file_path or settings.ai_settings_file

    def load(self) -> AISettings:
        try:
            raw = self._file_path.read_text(encoding="utf-8")
            return AISettings.model_validate_json(raw)
        except FileNotFoundError:
            return AISettings()
        except Exception as exc:
            logger.warning("Could not read %s, using defaults: %s", self._file_path, exc)
            return AISettings()

    def save(self, ai_settings: AISettings) -> None:
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        self._file_path.write_text(ai_settings.model_dump_json(indent=2), encoding="utf-8")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/test_ai_settings_service.py -v`
Expected: 4 passed

- [ ] **Step 7: Commit**

```bash
git add agents/config.py agents/models/schemas.py agents/services/ai_settings_service.py \
        agents/tests/test_ai_settings_service.py
git commit -m "feat: add AI settings persistence (data/ai-settings.json)"
```

---

## Task 6: Wire the router into main.py and the four agents

**Files:**
- Modify: `agents/agents/search.py`
- Modify: `agents/agents/wiki.py`
- Modify: `agents/agents/edit.py`
- Modify: `agents/agents/ingestion.py`
- Modify: `agents/main.py`
- Test: `agents/tests/test_main_settings_endpoints.py`

**Interfaces:**
- Consumes: `LLMRouter` (Task 4), `AISettingsService`, `AISettings`, `AISettingsResponse`, `AISettingsUpdateRequest` (Task 5), `PROVIDER_SPECS`, `create_provider` (Task 3)
- Produces: `GET /settings`, `POST /settings`, `GET /providers/{provider_id}/models` on the agent FastAPI app — these are what Task 7's Express routes proxy to.

This task renames each agent's `self._ollama` (typed `OllamaService`) to `self._llm` (typed `LLMRouter`) — a mechanical rename, since `LLMRouter` exposes the identical two methods agents already call. Every call site keeps calling `.generate(...)` / `.embed(...)`; only the attribute name, import, and constructor parameter type change.

- [ ] **Step 1: Rename in `agents/agents/search.py`**

```diff
-from services.ollama_service import OllamaService
+from services.llm_router import LLMRouter

 class SearchAgent:
-    def __init__(self, ollama: OllamaService, chroma: ChromaService) -> None:
-        self._ollama = ollama
+    def __init__(self, llm: LLMRouter, chroma: ChromaService) -> None:
+        self._llm = llm
         self._chroma = chroma
```

And at the two call sites (embed on the query, generate on the RAG prompt):

```diff
-        query_embedding = await self._ollama.embed(query)
+        query_embedding = await self._llm.embed(query)
```

```diff
-        answer = await self._ollama.generate(prompt)
+        answer = await self._llm.generate(prompt)
```

- [ ] **Step 2: Rename in `agents/agents/wiki.py`**

```diff
-from services.ollama_service import OllamaService
+from services.llm_router import LLMRouter

 class WikiAgent:
-    def __init__(self, ollama: OllamaService, chroma: ChromaService) -> None:
-        self._ollama = ollama
+    def __init__(self, llm: LLMRouter, chroma: ChromaService) -> None:
+        self._llm = llm
         self._chroma = chroma
```

Replace all three `self._ollama.generate(...)` call sites (in `_extract_entities`, `_generate_source_page`, `_generate_entity_page`) with `self._llm.generate(...)`.

- [ ] **Step 3: Rename in `agents/agents/edit.py`**

```diff
-from services.ollama_service import OllamaService
+from services.llm_router import LLMRouter

 class EditAgent:
     def __init__(
         self,
-        ollama: OllamaService,
+        llm: LLMRouter,
         chroma: ChromaService,
         changelog: ChangelogService,
     ) -> None:
-        self._ollama = ollama
+        self._llm = llm
         self._chroma = chroma
         self._changelog = changelog
```

Replace all four `self._ollama.generate(...)` / `self._ollama.embed(...)` call sites (in `_parse_instruction`, `_find_affected_pages`, `preview_edit`, `apply_edit`) with `self._llm.generate(...)` / `self._llm.embed(...)`.

- [ ] **Step 4: Rename in `agents/agents/ingestion.py`**

```diff
-from services.ollama_service import OllamaService
+from services.llm_router import LLMRouter

 class IngestionAgent:
     def __init__(
         self,
-        ollama: OllamaService,
+        llm: LLMRouter,
         chroma: ChromaService,
         markitdown: MarkItDownService,
     ) -> None:
-        self._ollama = ollama
+        self._llm = llm
```

Replace the one call site (`embedding = await self._ollama.embed(chunk)`) with `self._llm.embed(chunk)`.

- [ ] **Step 5: Wire everything together in `agents/main.py`**

Modify the imports (add alongside the existing `services.ollama_service` import):

```diff
+from models.schemas import AISettings, AISettingsResponse, AISettingsUpdateRequest
+from services.ai_settings_service import AISettingsService
+from services.llm_providers.base import AuthConfigError, TransientProviderError
+from services.llm_providers.registry import PROVIDER_SPECS, create_provider
+from services.llm_router import LLMRouter
 from services.changelog_service import ChangelogService
```

Modify the singleton construction block:

```diff
 ollama_svc = OllamaService()
 chroma_svc = ChromaService()
 markitdown_svc = MarkItDownService()
 changelog_svc = ChangelogService()
+ai_settings_svc = AISettingsService()
+llm_router = LLMRouter(ollama_svc)

-ingestion_agent = IngestionAgent(ollama_svc, chroma_svc, markitdown_svc)
-wiki_agent = WikiAgent(ollama_svc, chroma_svc)
-search_agent = SearchAgent(ollama_svc, chroma_svc)
-edit_agent = EditAgent(ollama_svc, chroma_svc, changelog_svc)
+ingestion_agent = IngestionAgent(llm_router, chroma_svc, markitdown_svc)
+wiki_agent = WikiAgent(llm_router, chroma_svc)
+search_agent = SearchAgent(llm_router, chroma_svc)
+edit_agent = EditAgent(llm_router, chroma_svc, changelog_svc)

+# In-memory API keys for this process. Set from env/.env at startup (dev
+# mode) and/or live via POST /settings (Electron, after decrypting its
+# store). Never written back to ai-settings.json — that file holds only
+# non-secret provider/model choice.
+_api_keys: dict[str, str] = {}
+if settings.anthropic_api_key:
+    _api_keys["anthropic"] = settings.anthropic_api_key
+if settings.openai_api_key:
+    _api_keys["openai"] = settings.openai_api_key
+if settings.xai_api_key:
+    _api_keys["xai"] = settings.xai_api_key
+
+
+class _UnconfiguredProvider:
+    """Sentinel for a provider that's marked active in ai-settings.json but
+    has no key available in this process yet (e.g. a fresh dev-mode start
+    without the matching env var). generate() must raise AuthConfigError —
+    the same contract as a revoked key — never silently behave like Ollama,
+    since active_provider_id still correctly reports the real provider."""
+
+    async def generate(self, prompt: str, system: str | None = None) -> str:
+        raise AuthConfigError("No API key configured for this provider in this session")
+
+
+def _apply_ai_settings(ai_settings) -> None:
+    """Configure llm_router from an AISettings object + the current _api_keys."""
+    provider_id = ai_settings.active_provider
+    if provider_id == "ollama":
+        llm_router.configure("ollama", None, ai_settings.auto_fallback_to_ollama)
+        return
+    api_key = _api_keys.get(provider_id)
+    provider_settings = ai_settings.providers.get(provider_id)
+    if not api_key or not provider_settings:
+        llm_router.configure(provider_id, _UnconfiguredProvider(), ai_settings.auto_fallback_to_ollama)
+        return
+    generator = create_provider(provider_id, api_key=api_key, model=provider_settings.model)
+    llm_router.configure(provider_id, generator, ai_settings.auto_fallback_to_ollama)
+
+
+_apply_ai_settings(ai_settings_svc.load())
```

Replace the two direct `ollama_svc.generate(...)` call sites (in `propose_wiki_structure` and `setup_wiki`) with `llm_router.generate(...)`.

Add the three new endpoints — insert a new section right after the `Edit Agent` section (after the existing `get_edit_history` endpoint, before `# Entry point`):

```python
# ---------------------------------------------------------------------------
# AI Settings
# ---------------------------------------------------------------------------

@app.get("/settings", response_model=AISettingsResponse)
async def get_ai_settings() -> AISettingsResponse:
    ai_settings = ai_settings_svc.load()
    return AISettingsResponse(
        active_provider=ai_settings.active_provider,
        auto_fallback_to_ollama=ai_settings.auto_fallback_to_ollama,
        providers=ai_settings.providers,
        keys_configured={pid: pid in _api_keys for pid in PROVIDER_SPECS if pid != "ollama"},
    )


@app.post("/settings", response_model=AISettingsResponse)
async def update_ai_settings(req: AISettingsUpdateRequest) -> AISettingsResponse:
    if req.active_provider not in PROVIDER_SPECS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.active_provider!r}")

    if req.api_key:
        _api_keys[req.active_provider] = req.api_key

    new_settings = AISettings(
        active_provider=req.active_provider,
        auto_fallback_to_ollama=req.auto_fallback_to_ollama,
        providers=req.providers,
    )
    ai_settings_svc.save(new_settings)
    _apply_ai_settings(new_settings)

    return AISettingsResponse(
        active_provider=new_settings.active_provider,
        auto_fallback_to_ollama=new_settings.auto_fallback_to_ollama,
        providers=new_settings.providers,
        keys_configured={pid: pid in _api_keys for pid in PROVIDER_SPECS if pid != "ollama"},
    )


@app.get("/providers/{provider_id}/models")
async def list_provider_models(provider_id: str) -> list[str]:
    if provider_id not in PROVIDER_SPECS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider_id!r}")
    if provider_id == "ollama":
        raise HTTPException(status_code=400, detail="Ollama models are not managed here — see OLLAMA_MODEL")

    api_key = _api_keys.get(provider_id)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key set for provider {provider_id!r}")

    # The model field is irrelevant for list_models() — this client is only
    # used to call it, never to generate().
    provider = create_provider(provider_id, api_key=api_key, model="")
    try:
        return await provider.list_models()
    except AuthConfigError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except TransientProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
```

- [ ] **Step 6: Write the failing tests for the new endpoints**

Create `agents/tests/test_main_settings_endpoints.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from services.llm_providers.base import AuthConfigError


@pytest.fixture
def client():
    return TestClient(main.app)


def test_get_settings_defaults_to_ollama(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()

    response = client.get("/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["active_provider"] == "ollama"
    assert body["keys_configured"] == {"anthropic": False, "openai": False, "xai": False}


def test_post_settings_rejects_unknown_provider(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"

    response = client.post("/settings", json={"active_provider": "copilot"})

    assert response.status_code == 400


def test_post_settings_stores_key_and_configures_router(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()

    response = client.post(
        "/settings",
        json={
            "active_provider": "anthropic",
            "auto_fallback_to_ollama": True,
            "providers": {"anthropic": {"model": "claude-sonnet-5"}},
            "api_key": "sk-test-key",
        },
    )

    assert response.status_code == 200
    assert response.json()["keys_configured"]["anthropic"] is True
    assert main.llm_router.active_provider_id == "anthropic"
    assert main._api_keys["anthropic"] == "sk-test-key"


def test_list_provider_models_requires_key(client):
    main._api_keys.pop("anthropic", None)

    response = client.get("/providers/anthropic/models")

    assert response.status_code == 400


def test_list_provider_models_maps_auth_error_to_401(client):
    main._api_keys["anthropic"] = "sk-bad"
    with patch(
        "main.create_provider",
        return_value=AsyncMock(list_models=AsyncMock(side_effect=AuthConfigError("bad key"))),
    ):
        response = client.get("/providers/anthropic/models")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_apply_ai_settings_raises_auth_error_when_active_provider_has_no_key():
    from models.schemas import AISettings, ProviderSettings

    main._api_keys.pop("anthropic", None)
    main._apply_ai_settings(
        AISettings(
            active_provider="anthropic",
            auto_fallback_to_ollama=True,
            providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
        )
    )

    assert main.llm_router.active_provider_id == "anthropic"
    with pytest.raises(AuthConfigError):
        await main.llm_router.generate("hi")
```

- [ ] **Step 7: Run the tests to verify they fail, then implement, then pass**

Run: `python -m pytest tests/test_main_settings_endpoints.py -v`
Expected first: FAIL (endpoints don't exist yet — this confirms step 5 hasn't landed if run out of order).
After step 5's edits are in place, re-run: `python -m pytest tests/test_main_settings_endpoints.py -v`
Expected: 6 passed

- [ ] **Step 8: Run the full Python test suite**

Run (from `agents/`): `python -m pytest tests/ -v`
Expected: all tests across every task so far pass together (no import cycles, no leftover `OllamaService` type hints in the four agents).

- [ ] **Step 9: Commit**

```bash
git add agents/agents/search.py agents/agents/wiki.py agents/agents/edit.py agents/agents/ingestion.py \
        agents/main.py agents/tests/test_main_settings_endpoints.py
git commit -m "feat: wire LLMRouter into all agents; add /settings and /providers endpoints"
```

---

## Task 7: Express proxy routes

**Files:**
- Modify: `server/index.ts`
- Test: `server/index.test.ts`

**Interfaces:**
- Consumes: agent's `GET/POST /settings`, `GET /providers/:id/models` (Task 6), existing `proxyToAgent()` helper
- Produces: `GET /api/ai/settings`, `PUT /api/ai/settings`, `GET /api/ai/providers/:id/models`

- [ ] **Step 1: Write the failing tests**

None of the existing `/api/ai/*` proxy routes have test coverage today —
`server/index.test.ts` has no `fetch` mocking of any kind yet (checked: zero
matches for `vi.stubGlobal`, `vi.mock`, or `global.fetch` in the file). This
task adds the first tests for this section, using the same `vi.stubGlobal`
approach `src/test-setup.ts` already uses for `WebSocket`, kept local to
these tests via `beforeEach`/`afterEach` so it doesn't affect other
describe blocks in the file.

Modify the `vitest` import at the top of `server/index.test.ts`:

```diff
-import { describe, it, expect, beforeAll, afterAll } from 'vitest'
+import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
```

Add a new `describe` block at the end of `server/index.test.ts`:

```typescript
describe('AI settings proxy routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET /api/ai/settings proxies to the agent', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        active_provider: 'ollama',
        auto_fallback_to_ollama: true,
        providers: {},
        keys_configured: { anthropic: false, openai: false, xai: false },
      }),
    })

    const res = await request(app).get('/api/ai/settings')

    expect(res.status).toBe(200)
    expect(res.body.active_provider).toBe('ollama')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/settings')
    expect(options.method).toBeUndefined()
  })

  it('PUT /api/ai/settings proxies the body to the agent as a POST', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        active_provider: 'anthropic',
        auto_fallback_to_ollama: true,
        providers: {},
        keys_configured: { anthropic: true, openai: false, xai: false },
      }),
    })

    const res = await request(app)
      .put('/api/ai/settings')
      .send({ active_provider: 'anthropic', auto_fallback_to_ollama: true, providers: {}, api_key: 'sk-test' })

    expect(res.status).toBe(200)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/settings')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      active_provider: 'anthropic',
      auto_fallback_to_ollama: true,
      providers: {},
      api_key: 'sk-test',
    })
  })

  it('GET /api/ai/settings returns 503 when the agent is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))

    const res = await request(app).get('/api/ai/settings')

    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'Agent service not running' })
  })

  it('GET /api/ai/providers/:providerId/models proxies to the agent', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ['claude-opus-5', 'claude-sonnet-5'],
    })

    const res = await request(app).get('/api/ai/providers/anthropic/models')

    expect(res.status).toBe(200)
    expect(res.body).toEqual(['claude-opus-5', 'claude-sonnet-5'])
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/providers/anthropic/models')
  })

  it('GET /api/ai/providers/:providerId/models returns 503 when the agent is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))

    const res = await request(app).get('/api/ai/providers/anthropic/models')

    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- server/index.test.ts`
Expected: FAIL — routes don't exist (404s)

- [ ] **Step 3: Implement the routes**

Modify `server/index.ts` — add right after the existing `app.get('/api/ai/edit/history', ...)` block (before the `// ─── HTTP + WebSocket ───` section header):

```typescript
app.get('/api/ai/settings', async (_req, res) => {
  try {
    const r = await proxyToAgent('/settings')
    res.status(r.status).json(await r.json())
  } catch {
    res.status(503).json({ error: 'Agent service not running' })
  }
})

app.put('/api/ai/settings', async (req, res) => {
  try {
    const r = await proxyToAgent('/settings', { method: 'POST', body: JSON.stringify(req.body) })
    res.status(r.status).json(await r.json())
  } catch {
    res.status(503).json({ error: 'Agent service not running' })
  }
})

app.get('/api/ai/providers/:providerId/models', async (req, res) => {
  try {
    const r = await proxyToAgent(`/providers/${req.params.providerId}/models`)
    res.status(r.status).json(await r.json())
  } catch {
    res.status(503).json({ error: 'Agent service not running' })
  }
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- server/index.test.ts`
Expected: all pass, including the 4 new tests

- [ ] **Step 5: Run the full coverage check**

Run: `npm run test:coverage`
Expected: 100% maintained (the `include`/`exclude` list in `vitest.config.ts` already covers `server/index.ts` in full — no config change needed, just make sure the new branches are exercised, which the tests above do: success, 503, and both HTTP methods).

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/index.test.ts
git commit -m "feat: proxy AI settings/provider-models endpoints through Express"
```

---

## Task 8: Electron key storage, IPC, and env injection

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

**Interfaces:**
- Consumes: agent's `POST /settings` (Task 6, via HTTP from the main process — Electron already knows `AGENT_PORT`/`apiPort` conventions used elsewhere in this file)
- Produces: `window.electronAPI.saveProviderKey(providerId: string, apiKey: string): Promise<void>`, `window.electronAPI.getConfiguredProviders(): Promise<string[]>` — consumed by Task 9's Settings UI.

No new automated tests — `electron/**` is intentionally outside `vitest.config.ts`'s coverage `include` list (confirmed: only `src/**/*.{ts,tsx}` and `server/index.ts` are covered), matching every other piece of `electron/main.ts`, which also has no unit tests today. This task ends with a manual verification step instead.

- [ ] **Step 1: Add `safeStorage` to the Electron import and add the secrets file helpers**

Modify `electron/main.ts` line 1:

```diff
-import { app, BrowserWindow, shell, Menu, dialog, ipcMain } from 'electron'
+import { app, BrowserWindow, shell, Menu, dialog, ipcMain, safeStorage } from 'electron'
```

Add near `getUserDataDir()` / `ensureUserData()` (around line 112-130):

```typescript
/**
 * Path to the encrypted provider-API-key store. Lives in Electron's own
 * userData dir regardless of dev/prod — this is Electron-only bookkeeping,
 * never read directly by the Python agent (which only ever sees a decrypted
 * key via env var or POST /settings).
 */
function getSecretsFilePath(): string {
  return path.join(app.getPath('userData'), 'data', '.secrets.enc')
}

/** provider id -> base64-encoded encrypted API key */
function loadEncryptedKeys(): Record<string, string> {
  const filePath = getSecretsFilePath()
  if (!fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function saveProviderKeyEncrypted(providerId: string, apiKey: string): void {
  const filePath = getSecretsFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const keys = loadEncryptedKeys()
  keys[providerId] = safeStorage.encryptString(apiKey).toString('base64')
  fs.writeFileSync(filePath, JSON.stringify(keys, null, 2))
}

function decryptProviderKey(providerId: string): string | null {
  const keys = loadEncryptedKeys()
  const encoded = keys[providerId]
  if (!encoded) return null
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch (err) {
    console.error(`[Electron] Failed to decrypt key for ${providerId}:`, err)
    return null
  }
}

/** Provider ids that currently have a decryptable key stored. */
function getConfiguredProviderIds(): string[] {
  return Object.keys(loadEncryptedKeys()).filter((id) => decryptProviderKey(id) !== null)
}

const AGENT_ENV_VAR_BY_PROVIDER: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
}

/** Push a freshly-saved key into the already-running agent process without a restart. */
async function pushProviderKeyToAgent(providerId: string, apiKey: string): Promise<void> {
  try {
    await fetch(`http://localhost:${AGENT_PORT}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active_provider: providerId,
        auto_fallback_to_ollama: true,
        providers: {},
        api_key: apiKey,
      }),
    })
  } catch (err) {
    console.warn('[Electron] Could not push provider key to agent (it may not be running yet):', err)
  }
}
```

- [ ] **Step 2: Inject stored keys into `agentEnv` at spawn time**

Modify the `agentEnv` construction block (around line 613-624) so a freshly-spawned agent picks up whatever was saved in a previous session:

```diff
   const agentEnv: NodeJS.ProcessEnv = { 
     ...process.env,
     PYTHONUNBUFFERED: '1',
   }
+
+  // Restore any previously-saved provider keys (decrypted in-memory only,
+  // never written back to a plaintext file by this process).
+  for (const providerId of getConfiguredProviderIds()) {
+    const key = decryptProviderKey(providerId)
+    const envVar = AGENT_ENV_VAR_BY_PROVIDER[providerId]
+    if (key && envVar) agentEnv[envVar] = key
+  }
```

- [ ] **Step 3: Add the IPC handlers**

Modify `electron/main.ts` — add alongside the existing handlers registered in `app.whenReady()` (right after the existing `ipcMain.handle('get-ai-status', ...)` at line 981):

```typescript
  // IPC handler to save a provider's API key (encrypted at rest) and push it
  // live to the running agent process
  ipcMain.handle('save-provider-key', async (_event, providerId: string, apiKey: string) => {
    saveProviderKeyEncrypted(providerId, apiKey)
    await pushProviderKeyToAgent(providerId, apiKey)
  })

  // IPC handler to list which providers currently have a key configured
  ipcMain.handle('get-configured-providers', () => getConfiguredProviderIds())
```

- [ ] **Step 4: Expose the new methods from the preload bridge**

Modify `electron/preload.ts` — add inside the `contextBridge.exposeInMainWorld('electronAPI', {...})` call, alongside `getAIStatus`:

```diff
   // Get AI service status (ollama, chroma, agent, overall)
   getAIStatus: () => ipcRenderer.invoke('get-ai-status'),
+
+  // Save a provider's API key (encrypted at rest via Electron safeStorage)
+  saveProviderKey: (providerId: string, apiKey: string) =>
+    ipcRenderer.invoke('save-provider-key', providerId, apiKey),
+
+  // List provider ids that currently have a key configured
+  getConfiguredProviders: () => ipcRenderer.invoke('get-configured-providers'),
```

And update the `Window.electronAPI` type declaration at the bottom of the same file:

```diff
       getAIStatus: () => Promise<AIServiceStatus>
+      saveProviderKey: (providerId: string, apiKey: string) => Promise<void>
+      getConfiguredProviders: () => Promise<string[]>
```

- [ ] **Step 5: Manual verification (no automated test harness exists for `electron/main.ts`)**

Run the packaged dev app (`npm run electron:dev` or whatever the project's existing Electron dev script is named — check `package.json`'s `scripts` block) and in the DevTools console of the renderer, run:

```js
await window.electronAPI.saveProviderKey('anthropic', 'sk-ant-test-key-123')
await window.electronAPI.getConfiguredProviders()
// -> ['anthropic']
```

Then quit and relaunch the app, and confirm `getConfiguredProviders()` still returns `['anthropic']` (proving the encrypted file round-trips across restarts) and that the agent's `GET /settings` response (`curl http://localhost:8000/settings`) shows `"anthropic": true` under `keys_configured` after the app has fully started (proving the env-var injection on spawn worked).

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: encrypt and store provider API keys via Electron safeStorage"
```

---

## Task 9: Settings UI panel

**Files:**
- Create: `src/components/AISettingsPanel.tsx`
- Modify: `src/components/Layout.tsx`
- Test: `src/components/AISettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/ai/settings`, `GET /api/ai/providers/:id/models` (Task 7); `window.electronAPI.saveProviderKey` (Task 8, optional — component must work when `window.electronAPI` is undefined, i.e. running in a plain browser/dev-without-Electron)
- Produces: an `AISettingsPanel` component with the same `{ isOpen, onClose }` prop shape as the existing `AIEditPanel`, opened from a new toolbar button in `Layout.tsx`.

- [ ] **Step 1: Write the failing component tests**

Create `src/components/AISettingsPanel.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
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

test('fetching models populates the model dropdown and enables save', async () => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/ai/settings')) {
      return Promise.resolve({ ok: true, json: async () => mockSettingsResponse } as Response)
    }
    if (url.includes('/api/ai/providers/anthropic/models')) {
      return Promise.resolve({ ok: true, json: async () => ['claude-opus-5', 'claude-sonnet-5'] } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  render(<AISettingsPanel isOpen={true} onClose={() => {}} />)
  await waitFor(() => screen.getByLabelText(/provider/i))
  fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'anthropic' } })
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-test' } })

  fireEvent.click(screen.getByRole('button', { name: /fetch models/i }))

  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'claude-sonnet-5' })).toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
})

test('shows an error when fetching models fails (invalid key)', async () => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/AISettingsPanel.test.tsx`
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Implement `AISettingsPanel`**

Create `src/components/AISettingsPanel.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react'
import { X, Loader2, AlertTriangle, KeyRound } from 'lucide-react'
import { api } from '../utils/api'

interface ProviderSettings {
  model: string
}

interface AISettingsResponse {
  active_provider: string
  auto_fallback_to_ollama: boolean
  providers: Record<string, ProviderSettings>
  keys_configured: Record<string, boolean>
}

const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama (local)',
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  xai: 'xAI (Grok)',
}

interface AISettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function AISettingsPanel({ isOpen, onClose }: AISettingsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState('ollama')
  const [autoFallback, setAutoFallback] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [keysConfigured, setKeysConfigured] = useState<Record<string, boolean>>({})

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(api('/api/ai/settings'))
      const data: AISettingsResponse = await res.json()
      setActiveProvider(data.active_provider)
      setAutoFallback(data.auto_fallback_to_ollama)
      setKeysConfigured(data.keys_configured)
      const providerSettings = data.providers[data.active_provider]
      if (providerSettings) {
        setSelectedModel(providerSettings.model)
        setModels([providerSettings.model])
      }
    } catch {
      setError('Could not load AI settings — is the server running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) loadSettings()
  }, [isOpen, loadSettings])

  const handleProviderChange = (providerId: string) => {
    setActiveProvider(providerId)
    setApiKey('')
    setModels([])
    setSelectedModel('')
    setError(null)
  }

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setError(null)
    try {
      if (window.electronAPI?.isElectron) {
        await window.electronAPI.saveProviderKey(activeProvider, apiKey)
      }
      // Send the key to the (possibly non-Electron) running agent for this
      // session so model-listing can use it even without Electron.
      await fetch(api('/api/ai/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: activeProvider,
          auto_fallback_to_ollama: autoFallback,
          providers: {},
          api_key: apiKey,
        }),
      })
      const res = await fetch(api(`/api/ai/providers/${activeProvider}/models`))
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Could not verify this API key')
      }
      const modelList: string[] = await res.json()
      setModels(modelList)
      setSelectedModel(modelList[0] ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify this API key')
    } finally {
      setFetchingModels(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(api('/api/ai/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_provider: activeProvider,
          auto_fallback_to_ollama: autoFallback,
          providers:
            activeProvider === 'ollama' ? {} : { [activeProvider]: { model: selectedModel } },
        }),
      })
      if (!res.ok) throw new Error('Failed to save settings')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const needsKey = activeProvider !== 'ollama'
  const canSave = !needsKey || (models.length > 0 && !!selectedModel)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-elevated)] rounded-lg shadow-xl w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">AI Provider Settings</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="ai-provider-select" className="block text-xs text-[var(--text-muted)] mb-1">
                Provider
              </label>
              <select
                id="ai-provider-select"
                aria-label="Provider"
                value={activeProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-base)] text-sm"
              >
                {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {needsKey && (
              <>
                <div>
                  <label htmlFor="ai-provider-key" className="block text-xs text-[var(--text-muted)] mb-1">
                    API key {keysConfigured[activeProvider] && '(already set — enter to replace)'}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="ai-provider-key"
                      aria-label="API key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-base)] text-sm"
                    />
                    <button
                      onClick={handleFetchModels}
                      disabled={!apiKey || fetchingModels}
                      className="px-2 py-1.5 rounded bg-[var(--accent)] text-white text-xs flex items-center gap-1 disabled:opacity-50"
                    >
                      {fetchingModels ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                      Fetch models
                    </button>
                  </div>
                </div>

                {models.length > 0 && (
                  <div>
                    <label htmlFor="ai-model-select" className="block text-xs text-[var(--text-muted)] mb-1">
                      Model
                    </label>
                    <select
                      id="ai-model-select"
                      aria-label="Model"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-base)] text-sm"
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={autoFallback}
                    onChange={(e) => setAutoFallback(e.target.checked)}
                  />
                  Fall back to Ollama automatically if {PROVIDER_LABELS[activeProvider]} fails
                </label>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-[var(--error,#f38ba8)]">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-xs disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/components/AISettingsPanel.test.tsx`
Expected: 6 passed

- [ ] **Step 5: Wire the panel into `Layout.tsx`**

Modify `src/components/Layout.tsx`:

```diff
 import { PanelLeftClose, PanelLeftOpen, ChevronLeft, Moon, Wand2 } from 'lucide-react'
+import { Settings } from 'lucide-react'
 import SirenIcon from './SirenIcon'
 import Sidebar from './Sidebar'
 import AIEditPanel from './AIEditPanel'
+import AISettingsPanel from './AISettingsPanel'
```

```diff
   const [aiEditPanelOpen, setAiEditPanelOpen] = useState(false)
+  const [aiSettingsPanelOpen, setAiSettingsPanelOpen] = useState(false)
```

Add a toolbar button next to the existing "AI Edit" button (after its closing `</button>`, before the theme-toggle button):

```tsx
          <button
            onClick={() => setAiSettingsPanelOpen(true)}
            className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="AI Provider Settings"
          >
            <Settings size={15} />
          </button>
```

Add the panel next to the existing `<AIEditPanel ... />` at the bottom of the component:

```tsx
      <AISettingsPanel isOpen={aiSettingsPanelOpen} onClose={() => setAiSettingsPanelOpen(false)} />
```

- [ ] **Step 6: Run the full frontend test suite and coverage check**

Run: `npm test` then `npm run test:coverage`
Expected: all pass, 100% coverage maintained (the new button in `Layout.tsx` needs its `onClick` exercised — add one assertion to `Layout.test.tsx` if the coverage report flags it: render `Layout`, click the new gear-icon button, assert the settings panel becomes visible).

- [ ] **Step 7: Commit**

```bash
git add src/components/AISettingsPanel.tsx src/components/AISettingsPanel.test.tsx src/components/Layout.tsx
git commit -m "feat: add AI provider Settings panel"
```

---

## Task 10: Fallback toast and status extension

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/AIToast.tsx`
- Create: `src/components/AIToast.test.tsx` (this component currently has no test file at all — a pre-existing gap, not something introduced here; this task only covers the new `ai:fallback` behavior, not a full retroactive test suite for the rest of the component)
- Modify: `electron/main.ts` (status object)

**Interfaces:**
- Consumes: the `ai:fallback` WebSocket event emitted by `LLMRouter._on_fallback` (Task 4)
- Produces: a rendered fallback toast in the existing `AIToast` component; an extended Electron `aiStatus` object reporting per-provider configured/reachable state

- [ ] **Step 1: Add the new WS event type**

Modify `src/types/index.ts`:

```diff
   | { event: 'ai:wiki:created'; data: { wikiId: string; page: string; title: string } }
+  | { event: 'ai:fallback'; data: { provider: string } }
```

- [ ] **Step 2: Write the failing tests**

`useWikiSocket` (in `src/hooks/useWiki.ts`) opens a real `WebSocket`, but
`src/test-setup.ts` already stubs the global `WebSocket` with a
`MockWebSocket` class that exposes `MockWebSocket.lastInstance` and lets a
test drive `onmessage` directly — this is the established, working
mechanism for simulating a WS event in this codebase (used implicitly by
`useWikiSocket` in every environment where tests run); `AIToast` doesn't
need to be modified or specially wired for this to work.

Create `src/components/AIToast.test.tsx`:

```typescript
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
  render(
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/components/AIToast.test.tsx`
Expected: FAIL — `PROVIDER_LABELS` import and the `ai:fallback` branch don't exist yet in `AIToast.tsx`

- [ ] **Step 4: Implement the fallback toast**

Modify `src/components/AIToast.tsx`:

```diff
 interface Toast {
-  id: string
-  type: 'processing' | 'done' | 'error' | 'wiki-created'
+  id: string
+  type: 'processing' | 'done' | 'error' | 'wiki-created' | 'fallback'
   wikiId: string
   file?: string
   title?: string
   page?: string
   error?: string
+  provider?: string
   ts: number
 }
```

```diff
       } else if (e.event === 'ai:wiki:created') {
         setToasts((prev) => [
           ...prev,
           {
             id: `wiki-${e.data.wikiId}-${e.data.page}-${now}`,
             type: 'wiki-created',
             wikiId: e.data.wikiId,
             title: e.data.title,
             page: e.data.page,
             ts: now,
           },
         ])
+      } else if (e.event === 'ai:fallback') {
+        setToasts((prev) => [
+          ...prev,
+          {
+            id: `fallback-${e.data.provider}-${now}`,
+            type: 'fallback',
+            wikiId: '',
+            provider: e.data.provider,
+            ts: now,
+          },
+        ])
       }
```

Add a `PROVIDER_LABELS` map (or reuse one exported from `AISettingsPanel.tsx` — export it from there and import here instead of duplicating) and a rendering branch:

```diff
             toast.type === 'wiki-created'
               ? 'bg-[var(--accent-faint,rgba(137,180,250,0.95))] border-[var(--accent)]'
+              : toast.type === 'fallback'
+              ? 'bg-[var(--warning-faint,rgba(249,226,175,0.95))] border-[var(--warning,#f9e2af)]'
               : 'bg-[var(--error-faint,rgba(243,139,168,0.95))] border-[var(--error,#f38ba8)]'
```

```diff
               {toast.type === 'wiki-created' && 'Wiki page created!'}
+              {toast.type === 'fallback' && 'Switched to Ollama'}
               {toast.type === 'error' && 'Processing failed'}
```

```diff
               {toast.error && <span className="text-[var(--error,#f38ba8)]">{toast.error}</span>}
+              {toast.type === 'fallback' && toast.provider && (
+                <span>
+                  {PROVIDER_LABELS[toast.provider] ?? toast.provider} was unavailable — fell back to Ollama for this request.
+                </span>
+              )}
```

(Export `PROVIDER_LABELS` from `src/components/AISettingsPanel.tsx` with `export const PROVIDER_LABELS = ...` and import it in `AIToast.tsx` instead of redefining it, to avoid the two labels drifting apart.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/components/AIToast.test.tsx`
Expected: pass

- [ ] **Step 6: Extend the Electron status object**

Modify `electron/main.ts` — extend the `AIServiceStatus` interface and its initial value (around line 29-40):

```diff
 interface AIServiceStatus {
   ollama: 'starting' | 'ready' | 'unavailable'
   chroma: 'starting' | 'ready' | 'unavailable'
   agent: 'starting' | 'ready' | 'unavailable'
   overall: 'starting' | 'ready' | 'degraded' | 'unavailable'
+  activeProvider: string
+  providerConfigured: boolean
 }
 let aiStatus: AIServiceStatus = {
   ollama: 'starting',
   chroma: 'starting', 
   agent: 'starting',
   overall: 'starting',
+  activeProvider: 'ollama',
+  providerConfigured: true,
 }
```

Update it once the agent is ready — inside `startAgentService()`, right after `aiStatus.agent = 'ready'` is set (around line 643):

```diff
   if (ready) {
     aiStatus.agent = 'ready'
     console.log('[Electron] Agent service ready')
+    try {
+      const settingsRes = await fetch(`http://localhost:${AGENT_PORT}/settings`)
+      if (settingsRes.ok) {
+        const data = await settingsRes.json()
+        aiStatus.activeProvider = data.active_provider
+        aiStatus.providerConfigured =
+          data.active_provider === 'ollama' || !!data.keys_configured[data.active_provider]
+      }
+    } catch {
+      // Non-fatal — status just won't reflect the active provider this run.
+    }
   } else {
```

Mirror the same type change in `electron/preload.ts`'s local `AIServiceStatus` interface (keep the two in sync, exactly as they already are today for the existing three fields).

- [ ] **Step 7: Manual verification**

Same as Task 8 Step 5 — this is `electron/**`, outside the coverage-enforced set. After setting a provider active via the Settings panel and restarting the app, confirm `await window.electronAPI.getAIStatus()` in DevTools shows the expected `activeProvider` and `providerConfigured` values.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/components/AIToast.tsx src/components/AIToast.test.tsx \
        src/components/AISettingsPanel.tsx electron/main.ts electron/preload.ts
git commit -m "feat: show a fallback toast and report active provider in AI status"
```

---

## Task 11: Documentation

**Files:**
- Modify: `docs/TECHNICAL.md`
- Modify: `docs/USER-GUIDE.md`
- Modify: `docs/API.md`
- Modify: `README.md`

No tests — this is documentation. Each step is a targeted addition to an existing doc, in that doc's existing voice/format (checked in the spec phase).

- [ ] **Step 1: `docs/TECHNICAL.md`**

Add a new subsection under "AI Agents Deep Dive" → "Services", after the existing `OllamaService` subsection:

```markdown
#### LLMRouter (`agents/services/llm_router.py`)

The single `generate()`/`embed()` entry point every agent depends on —
`IngestionAgent`, `SearchAgent`, `WikiAgent`, and `EditAgent` all hold an
`LLMRouter`, not an `OllamaService`, directly.

- `embed()` always delegates to `OllamaService` — no cloud provider here
  offers embeddings, so this never varies with the active provider.
- `generate()` routes to whichever provider is configured active
  (`agents/services/llm_providers/registry.py`): `ollama` (default),
  `anthropic` (Claude), `openai`, or `xai` (Grok, via the OpenAI-compatible
  adapter). On a transient error (rate limit, 5xx, network) it falls back
  to Ollama if `auto_fallback_to_ollama` is enabled, emitting an
  `ai:fallback` WebSocket event. On an auth/config error (bad or revoked
  key) it never falls back — the error surfaces to the caller so the user
  can fix their key.

Settings persist in `data/ai-settings.json` (provider, model, fallback
toggle — no secrets) via `agents/services/ai_settings_service.py`. API keys
live only in the running process's memory (`main._api_keys`), populated
from `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`XAI_API_KEY` env vars at startup
or set live via `POST /settings`. See "Configuration Files" below for how
Electron injects these.

#### AnthropicService / OpenAICompatibleService (`agents/services/llm_providers/`)

Thin adapters implementing the same `generate(prompt, system=None) -> str`
shape as `OllamaService`, plus a `list_models()` method used only by
Settings (never by generation) to populate the model dropdown from each
provider's live model list — no model IDs are hard-coded anywhere in the
app. `OpenAICompatibleService` backs both OpenAI and xAI, since xAI's API
is wire-compatible with the OpenAI SDK (same client, different
`base_url`).
```

- [ ] **Step 2: `docs/USER-GUIDE.md`**

Add a new top-level section (placed after whatever section currently documents AI search/ingestion — match the existing heading level and style):

```markdown
## AI Provider Settings

Wiki Explorer can use Ollama (free, fully local) or your own subscription
to Claude, OpenAI, or xAI (Grok) for search answers, wiki page generation,
and AI-assisted editing. Embeddings (what powers semantic search) always
run locally via Ollama, regardless of which provider you pick.

To switch providers, click the gear icon in the top bar to open **AI
Provider Settings**:

1. Pick a provider from the dropdown.
2. Paste your API key and click **Fetch models** — this validates the key
   and populates the model list with that provider's current models.
3. Pick a model and click **Save**.

If you don't have a subscription to any of these, leave the provider set
to **Ollama (local)** — nothing to configure, it's the default.

**Automatic fallback:** with the "Fall back to Ollama automatically"
checkbox on (the default), a temporary problem with your cloud provider
(rate limit, outage) is retried against Ollama automatically, with a
toast notification. A bad or expired API key is never silently retried —
you'll see a clear error so you can fix it in Settings.

**Running without the desktop app:** if you're running Wiki Explorer via
`scripts/start-ai.sh` instead of the packaged Electron app, the Settings
panel still works for your current session, but won't remember your key
across a restart — set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
`XAI_API_KEY` in `agents/.env` instead, the same way you'd set
`OLLAMA_BASE_URL`.
```

- [ ] **Step 3: `docs/API.md`**

Find the existing documentation for `/api/ai/edit/history` (or wherever the AI proxy routes are documented) and add entries in the same format immediately after it:

```markdown
### `GET /api/ai/settings`

Returns the current AI provider settings.

Response:
```json
{
  "active_provider": "anthropic",
  "auto_fallback_to_ollama": true,
  "providers": { "anthropic": { "model": "claude-sonnet-5" } },
  "keys_configured": { "anthropic": true, "openai": false, "xai": false }
}
```

### `PUT /api/ai/settings`

Updates AI provider settings. `api_key`, if present, sets the in-memory key
for `active_provider` for the current process only (Electron persists it
separately, encrypted, via IPC — see `docs/TECHNICAL.md`).

Request body:
```json
{
  "active_provider": "anthropic",
  "auto_fallback_to_ollama": true,
  "providers": { "anthropic": { "model": "claude-sonnet-5" } },
  "api_key": "sk-ant-..."
}
```

### `GET /api/ai/providers/:providerId/models`

Fetches the live list of available models for a cloud provider
(`anthropic`, `openai`, or `xai`), using whichever key is currently set
for it. Returns `400` if no key is set for that provider, `401` if the key
is rejected, `503` if the provider is transiently unreachable.

Response: `["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]`
```

- [ ] **Step 4: `README.md`**

```diff
 ## Tech Stack

 - **Frontend**: React, TypeScript, Tailwind CSS, Vite
 - **Backend**: Express.js, Node.js
 - **Desktop**: Electron
-- **AI**: Ollama (qwen3:8b), ChromaDB, nomic-embed-text
+- **AI**: Ollama (qwen3:8b, always used for embeddings; default/local generation),
+  plus optional Claude / OpenAI / xAI for generation if you'd rather use your own
+  subscription — ChromaDB for vector storage, nomic-embed-text for embeddings
 - **Python**: FastAPI, markitdown
```

- [ ] **Step 5: Commit**

```bash
git add docs/TECHNICAL.md docs/USER-GUIDE.md docs/API.md README.md
git commit -m "docs: document multi-provider LLM settings"
```

---

## Self-Review Notes

**Spec coverage:** every section of the spec maps to a task — architecture/registry (Tasks 2-4), settings/key lifecycle (Tasks 5, 6, 8), fallback signaling + status UI (Tasks 4, 10), testing (every task carries its own), documentation (Task 11), new dependencies (Tasks 2-3), rollout/defaults (Task 5's `AISettings()` default, verified in Task 6's `test_get_settings_defaults_to_ollama`).

**Type consistency:** `LLMRouter.generate(prompt, system=None)` / `.embed(text, max_chars=3000)` signatures match what Task 6 calls in all four agents; `AISettings` / `AISettingsResponse` / `AISettingsUpdateRequest` field names match between Task 5 (schemas) and Task 6 (endpoints) and Task 9 (frontend JSON keys use the same snake_case, matching the FastAPI/pydantic response bodies directly with no camelCase translation layer — consistent with how `SearchResponse` etc. are already consumed as raw JSON elsewhere in `src/`).

**Review Focus coverage:** all five items have an owning test — see the table above, each pointing at Task 4's `test_llm_router.py` or Task 6's endpoint tests.
