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
