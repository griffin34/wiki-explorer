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
