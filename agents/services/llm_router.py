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
        if self._active_id == "ollama":
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
