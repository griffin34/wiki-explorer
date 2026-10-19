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
        except (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError) as exc:
            raise AuthConfigError(str(exc)) from exc
        except (openai.RateLimitError, openai.APIConnectionError, openai.APIStatusError) as exc:
            raise TransientProviderError(str(exc)) from exc
        return [m.id for m in page.data]
