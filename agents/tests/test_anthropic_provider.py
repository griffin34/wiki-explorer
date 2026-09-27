from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import anthropic
import httpx
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


def _real_sdk_service(handler) -> AnthropicService:
    """AnthropicService whose client is a REAL anthropic.AsyncAnthropic with
    only the HTTP layer faked, so the SDK's real response parsing and
    pagination objects are exercised (a shape-mocked `models.list` hid a
    bug where the returned AsyncPage was iterated as a pydantic model)."""
    svc = AnthropicService(api_key="sk-test", model="claude-sonnet-5")
    svc._client = anthropic.AsyncAnthropic(
        api_key="sk-test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    return svc


def _model_info(model_id: str) -> dict:
    return {
        "id": model_id,
        "type": "model",
        "display_name": model_id,
        "created_at": "2026-01-01T00:00:00Z",
    }


@pytest.mark.asyncio
async def test_list_models_against_real_sdk_pagination():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        return httpx.Response(
            200,
            json={
                "data": [_model_info("claude-opus-5"), _model_info("claude-sonnet-5")],
                "has_more": False,
                "first_id": "claude-opus-5",
                "last_id": "claude-sonnet-5",
            },
        )

    svc = _real_sdk_service(handler)

    result = await svc.list_models()

    assert result == ["claude-opus-5", "claude-sonnet-5"]


@pytest.mark.asyncio
async def test_list_models_follows_real_sdk_auto_pagination():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("after_id") == "claude-opus-5":
            return httpx.Response(
                200,
                json={
                    "data": [_model_info("claude-sonnet-5")],
                    "has_more": False,
                    "first_id": "claude-sonnet-5",
                    "last_id": "claude-sonnet-5",
                },
            )
        return httpx.Response(
            200,
            json={
                "data": [_model_info("claude-opus-5")],
                "has_more": True,
                "first_id": "claude-opus-5",
                "last_id": "claude-opus-5",
            },
        )

    svc = _real_sdk_service(handler)

    result = await svc.list_models()

    assert result == ["claude-opus-5", "claude-sonnet-5"]


@pytest.mark.asyncio
async def test_list_models_maps_authentication_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}},
        )

    svc = _real_sdk_service(handler)

    with pytest.raises(AuthConfigError):
        await svc.list_models()


@pytest.mark.asyncio
async def test_list_models_maps_not_found_error_to_auth_config_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404,
            json={"type": "error", "error": {"type": "not_found_error", "message": "not found"}},
        )

    svc = _real_sdk_service(handler)

    with pytest.raises(AuthConfigError):
        await svc.list_models()


@pytest.mark.asyncio
async def test_list_models_maps_rate_limit_error_to_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}},
        )

    svc = _real_sdk_service(handler)

    with pytest.raises(TransientProviderError):
        await svc.list_models()
