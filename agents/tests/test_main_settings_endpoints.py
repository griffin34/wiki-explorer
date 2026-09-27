from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from services.llm_providers.base import AuthConfigError


@pytest.fixture
def client():
    return TestClient(main.app)


def test_get_settings_defaults_to_ollama(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()

    response = client.get("/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["active_provider"] == "ollama"
    assert body["keys_configured"] == {"anthropic": False, "openai": False, "xai": False}


def test_post_settings_rejects_unknown_provider(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"

    response = client.post("/settings", json={"active_provider": "copilot"})

    assert response.status_code == 400


def test_post_settings_stores_key_and_configures_router(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()

    response = client.post(
        "/settings",
        json={
            "active_provider": "anthropic",
            "auto_fallback_to_ollama": True,
            "providers": {"anthropic": {"model": "claude-sonnet-5"}},
            "api_key": "sk-test-key",
        },
    )

    assert response.status_code == 200
    assert response.json()["keys_configured"]["anthropic"] is True
    assert main.llm_router.active_provider_id == "anthropic"
    assert main._api_keys["anthropic"] == "sk-test-key"


def test_list_provider_models_requires_key(client):
    main._api_keys.pop("anthropic", None)

    response = client.get("/providers/anthropic/models")

    assert response.status_code == 400


def test_list_provider_models_maps_auth_error_to_401(client):
    main._api_keys["anthropic"] = "sk-bad"
    with patch(
        "main.create_provider",
        return_value=AsyncMock(list_models=AsyncMock(side_effect=AuthConfigError("bad key"))),
    ):
        response = client.get("/providers/anthropic/models")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_apply_ai_settings_raises_auth_error_when_active_provider_has_no_key():
    from models.schemas import AISettings, ProviderSettings

    main._api_keys.pop("anthropic", None)
    main._apply_ai_settings(
        AISettings(
            active_provider="anthropic",
            auto_fallback_to_ollama=True,
            providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
        )
    )

    assert main.llm_router.active_provider_id == "anthropic"
    with pytest.raises(AuthConfigError):
        await main.llm_router.generate("hi")
