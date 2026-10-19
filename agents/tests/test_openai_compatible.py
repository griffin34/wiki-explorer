from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
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
async def test_generate_maps_not_found_error_to_auth_config_error():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    svc._client.chat.completions.create = AsyncMock(
        side_effect=openai.NotFoundError(message="not found", response=MagicMock(status_code=404), body=None)
    )

    with pytest.raises(AuthConfigError):
        await svc.generate("hi")


@pytest.mark.asyncio
async def test_list_models_returns_ids():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    page = MagicMock()
    page.data = [MagicMock(id="gpt-5"), MagicMock(id="gpt-5-mini")]
    svc._client.models.list = AsyncMock(return_value=page)

    result = await svc.list_models()

    assert result == ["gpt-5", "gpt-5-mini"]


@pytest.mark.asyncio
async def test_list_models_maps_not_found_error_to_auth_config_error():
    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    svc._client.models.list = AsyncMock(
        side_effect=openai.NotFoundError(message="not found", response=MagicMock(status_code=404), body=None)
    )

    with pytest.raises(AuthConfigError):
        await svc.list_models()


@pytest.mark.asyncio
async def test_list_models_against_real_sdk_page():
    """Exercise the REAL openai.AsyncOpenAI client (only HTTP is faked) so the
    SDK's actual page object and response parsing are covered, not a mock of
    `models.list`'s return shape."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        return httpx.Response(
            200,
            json={
                "object": "list",
                "data": [
                    {"id": "gpt-5", "object": "model", "created": 1767225600, "owned_by": "openai"},
                    {"id": "gpt-5-mini", "object": "model", "created": 1767225600, "owned_by": "openai"},
                ],
            },
        )

    svc = OpenAICompatibleService(api_key="sk-test", base_url="https://api.openai.com/v1", model="gpt-5")
    svc._client = openai.AsyncOpenAI(
        api_key="sk-test",
        base_url="https://api.openai.com/v1",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    result = await svc.list_models()

    assert result == ["gpt-5", "gpt-5-mini"]
