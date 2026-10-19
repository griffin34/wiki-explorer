from __future__ import annotations

import json
from pathlib import Path

from models.schemas import AISettings, ProviderSettings
from services.ai_settings_service import AISettingsService


def test_load_returns_defaults_when_file_missing(tmp_path: Path):
    svc = AISettingsService(file_path=tmp_path / "ai-settings.json")

    result = svc.load()

    assert result == AISettings(active_provider="ollama", auto_fallback_to_ollama=True, providers={})


def test_load_returns_defaults_when_file_corrupt(tmp_path: Path):
    file_path = tmp_path / "ai-settings.json"
    file_path.write_text("{not valid json")
    svc = AISettingsService(file_path=file_path)

    result = svc.load()

    assert result.active_provider == "ollama"


def test_save_then_load_round_trips(tmp_path: Path):
    file_path = tmp_path / "ai-settings.json"
    svc = AISettingsService(file_path=file_path)
    original = AISettings(
        active_provider="anthropic",
        auto_fallback_to_ollama=False,
        providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
    )

    svc.save(original)
    result = svc.load()

    assert result == original


def test_save_creates_parent_directory(tmp_path: Path):
    file_path = tmp_path / "nested" / "dir" / "ai-settings.json"
    svc = AISettingsService(file_path=file_path)

    svc.save(AISettings())

    assert file_path.exists()
    assert json.loads(file_path.read_text())["active_provider"] == "ollama"
