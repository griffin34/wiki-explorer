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
