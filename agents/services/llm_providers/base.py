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
