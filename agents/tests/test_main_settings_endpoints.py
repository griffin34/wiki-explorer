from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from services.llm_providers.base import AuthConfigError, TransientProviderError


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


def test_post_settings_merges_providers_instead_of_replacing(client, tmp_path):
    from models.schemas import AISettings, ProviderSettings

    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()
    main.ai_settings_svc.save(
        AISettings(
            active_provider="anthropic",
            auto_fallback_to_ollama=True,
            providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
        )
    )

    response = client.post(
        "/settings",
        json={
            "active_provider": "openai",
            "auto_fallback_to_ollama": True,
            "providers": {"openai": {"model": "gpt-5"}},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body["providers"].keys()) == {"anthropic", "openai"}
    assert body["providers"]["anthropic"]["model"] == "claude-sonnet-5"
    assert body["providers"]["openai"]["model"] == "gpt-5"

    # Confirm it was actually persisted to disk, not just echoed in the response.
    persisted = main.ai_settings_svc.load()
    assert persisted.providers["anthropic"].model == "claude-sonnet-5"
    assert persisted.providers["openai"].model == "gpt-5"


def test_post_settings_with_empty_providers_does_not_wipe_existing(client, tmp_path):
    """Mirrors the frontend's "Fetch Models" call: it validates an API key by
    posting providers={} without the user ever clicking Save. This must be a
    no-op merge, not a wipe of previously configured providers."""
    from models.schemas import AISettings, ProviderSettings

    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()
    main.ai_settings_svc.save(
        AISettings(
            active_provider="anthropic",
            auto_fallback_to_ollama=True,
            providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
        )
    )

    response = client.post(
        "/settings",
        json={
            "active_provider": "anthropic",
            "auto_fallback_to_ollama": True,
            "providers": {},
            "api_key": "sk-test-key",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["providers"]["anthropic"]["model"] == "claude-sonnet-5"

    persisted = main.ai_settings_svc.load()
    assert persisted.providers["anthropic"].model == "claude-sonnet-5"


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


# ---------------------------------------------------------------------------
# POST /providers/{id}/key — stages a key for validation only
# ---------------------------------------------------------------------------

def test_set_provider_key_stores_key_without_touching_settings(client, tmp_path):
    """"Fetch Models" must not commit to a provider: staging a key may only
    update the in-memory key store. active_provider (on disk and in the
    router) stays unchanged until the user clicks Save."""
    from models.schemas import AISettings

    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()
    main.ai_settings_svc.save(AISettings(active_provider="ollama", auto_fallback_to_ollama=False))
    main._apply_ai_settings(main.ai_settings_svc.load())
    settings_file_before = main.ai_settings_svc._file_path.read_text()

    response = client.post("/providers/anthropic/key", json={"api_key": "sk-staged"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert main._api_keys["anthropic"] == "sk-staged"
    assert main.ai_settings_svc._file_path.read_text() == settings_file_before
    persisted = main.ai_settings_svc.load()
    assert persisted.active_provider == "ollama"
    assert persisted.auto_fallback_to_ollama is False
    assert main.llm_router.active_provider_id == "ollama"


def test_set_provider_key_does_not_create_settings_file(client, tmp_path):
    main.ai_settings_svc._file_path = tmp_path / "ai-settings.json"
    main._api_keys.clear()

    response = client.post("/providers/openai/key", json={"api_key": "sk-staged"})

    assert response.status_code == 200
    assert not main.ai_settings_svc._file_path.exists()


def test_set_provider_key_rejects_unknown_provider(client):
    main._api_keys.clear()

    response = client.post("/providers/copilot/key", json={"api_key": "sk-x"})

    assert response.status_code == 404
    assert "copilot" not in main._api_keys


def test_set_provider_key_rejects_ollama(client):
    main._api_keys.clear()

    response = client.post("/providers/ollama/key", json={"api_key": "sk-x"})

    assert response.status_code == 400
    assert "ollama" not in main._api_keys


# ---------------------------------------------------------------------------
# Provider errors map to actionable HTTP errors, not generic 500s
# ---------------------------------------------------------------------------

def test_search_maps_auth_config_error_to_401(tmp_path):
    client = TestClient(main.app, raise_server_exceptions=False)
    with patch.object(main.search_agent, "search", AsyncMock(side_effect=AuthConfigError("invalid x-api-key"))):
        response = client.post("/search", json={"wiki_id": "w1", "query": "hello"})

    assert response.status_code == 401
    assert response.json() == {
        "detail": "AI provider authentication failed: invalid x-api-key. Check your API key in AI Provider Settings."
    }


def test_search_maps_transient_provider_error_to_503():
    client = TestClient(main.app, raise_server_exceptions=False)
    with patch.object(main.search_agent, "search", AsyncMock(side_effect=TransientProviderError("rate limited"))):
        response = client.post("/search", json={"wiki_id": "w1", "query": "hello"})

    assert response.status_code == 503
    assert response.json() == {"detail": "AI provider temporarily unavailable: rate limited"}


def test_search_maps_router_auth_error_end_to_end():
    """Drive the real SearchAgent → llm_router.generate path, with the router
    pointed at an unconfigured cloud provider (the exact state a bad/missing
    key leaves it in)."""
    from models.schemas import AISettings, ProviderSettings

    client = TestClient(main.app, raise_server_exceptions=False)
    main._api_keys.pop("anthropic", None)
    main._apply_ai_settings(
        AISettings(
            active_provider="anthropic",
            auto_fallback_to_ollama=False,
            providers={"anthropic": ProviderSettings(model="claude-sonnet-5")},
        )
    )
    chroma_result = {"documents": [["some text"]], "metadatas": [[{"source_file": "a.md"}]], "distances": [[0.0]]}
    with patch.object(main.llm_router, "embed", AsyncMock(return_value=[0.1, 0.2])), patch.object(
        main.chroma_svc, "query_chunks", AsyncMock(return_value=chroma_result)
    ):
        response = client.post("/search", json={"wiki_id": "w1", "query": "hello"})

    assert response.status_code == 401
    assert response.json()["detail"].startswith("AI provider authentication failed:")


def test_edit_preview_reraises_auth_config_error_instead_of_masking_as_500():
    client = TestClient(main.app, raise_server_exceptions=False)
    with patch.object(main.edit_agent, "preview_edit", AsyncMock(side_effect=AuthConfigError("bad key"))):
        response = client.post("/edit/preview", json={"wiki_id": "w1", "instruction": "fix typos"})

    assert response.status_code == 401
    assert "AI provider authentication failed: bad key" in response.json()["detail"]


def test_edit_apply_reraises_transient_provider_error_instead_of_masking_as_500():
    client = TestClient(main.app, raise_server_exceptions=False)
    with patch.object(main.edit_agent, "apply_edit", AsyncMock(side_effect=TransientProviderError("overloaded"))):
        response = client.post("/edit/apply", json={"wiki_id": "w1", "edit_id": "e1"})

    assert response.status_code == 503
    assert response.json() == {"detail": "AI provider temporarily unavailable: overloaded"}


def test_manual_edit_reraises_auth_config_error_instead_of_masking_as_500():
    client = TestClient(main.app, raise_server_exceptions=False)
    with patch.object(main.edit_agent, "apply_manual_edit", AsyncMock(side_effect=AuthConfigError("bad key"))):
        response = client.put("/wikis/w1/pages/some-page", json={"content": "new"})

    assert response.status_code == 401


def test_edit_preview_still_maps_other_errors_to_500():
    client = TestClient(main.app, raise_server_exceptions=False)
    with patch.object(main.edit_agent, "preview_edit", AsyncMock(side_effect=ValueError("boom"))):
        response = client.post("/edit/preview", json={"wiki_id": "w1", "instruction": "x"})

    assert response.status_code == 500
    assert response.json() == {"detail": "boom"}
