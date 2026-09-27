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
