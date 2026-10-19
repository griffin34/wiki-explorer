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
        # models.list() returns an AsyncPaginator; async-iterating it walks
        # every page. (Awaiting it yields an AsyncPage, a pydantic model whose
        # plain iteration yields (field, value) tuples, not models.)
        try:
            return [m.id async for m in self._client.models.list()]
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.NotFoundError) as exc:
            raise AuthConfigError(str(exc)) from exc
        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
            raise TransientProviderError(str(exc)) from exc
