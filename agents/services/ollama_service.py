from __future__ import annotations

import logging
import re

import httpx

from config import settings

logger = logging.getLogger(__name__)

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


class OllamaService:
    async def generate(self, prompt: str, system: str | None = None) -> str:
        """Generate text (non-streaming). Strips <think>...</think> blocks from response."""
        payload: dict = {
            "model": settings.ollama_model,
            "prompt": prompt,
            "stream": False,
        }
        if system is not None:
            payload["system"] = system

        try:
            async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
                response = await client.post(
                    f"{settings.ollama_base_url}/api/generate",
                    json=payload,
                )
                response.raise_for_status()
                raw = response.json().get("response", "")
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"Ollama generate request failed with status {exc.response.status_code}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(f"Ollama generate request failed: {exc}") from exc

        return _THINK_RE.sub("", raw).strip()

    async def embed(self, text: str, max_chars: int = 3000) -> list[float]:
        """Get embeddings for text.
        
        Args:
            text: The text to embed
            max_chars: Max characters to send (default 3000 ~= 750 tokens, safe for 2048 limit)
        """
        # Truncate if too long (nomic-embed-text has 2048 token limit)
        if len(text) > max_chars:
            text = text[:max_chars]
            logger.debug("Truncated text from %d to %d chars for embedding", len(text), max_chars)
        
        # Clean problematic characters that can cause encoding issues
        text = text.replace("\x00", "").replace("\ufffd", "")
        
        payload = {
            "model": settings.ollama_embed_model,
            "prompt": text,
        }
        try:
            async with httpx.AsyncClient(timeout=settings.ollama_timeout) as client:
                response = await client.post(
                    f"{settings.ollama_base_url}/api/embeddings",
                    json=payload,
                )
                response.raise_for_status()
                return response.json()["embedding"]
        except httpx.HTTPStatusError as exc:
            # Log the actual error from Ollama for debugging
            error_body = ""
            try:
                error_body = exc.response.text[:500]
            except Exception:
                pass
            logger.error("Ollama embed failed (status %d): %s", exc.response.status_code, error_body)
            raise RuntimeError(
                f"Ollama embed request failed with status {exc.response.status_code}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(f"Ollama embed request failed: {exc}") from exc


async def check_health() -> bool:
    """Return True if the Ollama server is reachable."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            return response.status_code == 200
    except Exception:
        return False
