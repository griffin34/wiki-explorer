from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class ConversionResult:
    text: str
    title: str
    source_type: str


class MarkItDownService:
    def __init__(self) -> None:
        self._md = None  # lazy init

    def _get_converter(self):
        if self._md is None:
            from markitdown import MarkItDown

            self._md = MarkItDown()
        return self._md

    def convert(self, file_path: str | Path) -> ConversionResult:
        """Convert a file to Markdown. Raises RuntimeError on failure."""
        file_path = Path(file_path)
        source_type = file_path.suffix.lstrip(".").lower() or "unknown"
        try:
            result = self._get_converter().convert(str(file_path))
            text = result.text_content or ""
            title = getattr(result, "title", None) or file_path.stem
            return ConversionResult(text=text, title=str(title), source_type=source_type)
        except Exception as exc:
            raise RuntimeError(
                f"MarkItDown conversion failed for {file_path.name}: {exc}"
            ) from exc
