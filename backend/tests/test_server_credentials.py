import pytest

from app.access import AuthContext
from app.credentials import resolve_provider_settings
from app.errors import ApiError
from app.schemas import ProviderSettings
from app.settings import settings
from conftest import auth


def test_regular_user_cannot_request_server_credentials(client):
    session = client.post("/sessions", headers=auth()).json()["session_id"]
    response = client.post("/chat", headers=auth(), json={
        "session_id": session,
        "question": "hi",
        "provider": {"provider": "gemini", "credential_mode": "server", "embedding_provider": "gemini"},
    })
    assert response.status_code == 403
    assert response.json()["code"] == "server_credentials_forbidden"
    assert "server-gemini-test-key" not in response.text


def test_admin_identity_lists_only_configured_server_providers(client):
    login = client.post("/admin/login", json={"username": "admin", "password": "demo-test-password"})
    assert login.status_code == 200
    identity = client.get("/identity", headers={"Authorization": f"Bearer {login.json()['token']}"})
    data = identity.json()
    assert data["authentication"] == "admin"
    assert data["can_use_server_managed_keys"] is True
    assert data["server_key_providers"] == ["anthropic", "gemini", "openai"]
    assert "server-openai-test-key" not in identity.text


def test_server_credential_resolution_uses_provider_keys_and_never_falls_back(client, monkeypatch):
    admin = AuthContext("_admin", "admin")
    user = AuthContext("u-alpha", "user", "alpha")
    server_request = ProviderSettings(provider="gemini", credential_mode="server", embedding_provider="gemini")
    resolved = resolve_provider_settings(admin, server_request)
    assert resolved.api_key.get_secret_value() == "server-gemini-test-key"
    assert resolved.embedding_api_key.get_secret_value() == "server-gemini-test-key"

    with pytest.raises(ApiError) as forbidden:
        resolve_provider_settings(user, server_request)
    assert forbidden.value.code == "server_credentials_forbidden"

    monkeypatch.setattr(settings, "groq_api_key", None)
    unavailable = ProviderSettings(provider="groq", credential_mode="server", embedding_provider="gemini")
    with pytest.raises(ApiError) as missing:
        resolve_provider_settings(admin, unavailable)
    assert missing.value.code == "server_key_unavailable"


def test_user_mode_retains_own_key_even_when_server_key_exists(client):
    admin = AuthContext("_admin", "admin")
    user_request = ProviderSettings(provider="openai", api_key="user-owned-key", embedding_provider="openai")
    resolved = resolve_provider_settings(admin, user_request)
    assert resolved.api_key.get_secret_value() == "user-owned-key"
    assert resolved.credential_mode == "user"
