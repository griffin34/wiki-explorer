from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from config import settings
from models.schemas import AISettings

logger = logging.getLogger(__name__)


class AISettingsService:
    def __init__(self, file_path: Optional[Path] = None) -> None:
        self._file_path = file_path or settings.ai_settings_file

    def load(self) -> AISettings:
        try:
            raw = self._file_path.read_text(encoding="utf-8")
            return AISettings.model_validate_json(raw)
        except FileNotFoundError:
            return AISettings()
        except Exception as exc:
            logger.warning("Could not read %s, using defaults: %s", self._file_path, exc)
            return AISettings()

    def save(self, ai_settings: AISettings) -> None:
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        self._file_path.write_text(ai_settings.model_dump_json(indent=2), encoding="utf-8")
