import pytest

from app import accounts
from app.settings import settings

from conftest import ADMIN_TOKEN, TOKEN, auth

ADMIN = {"username": "admin", "password": "demo-test-password"}


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_guest_sign_in_gets_private_workspace(client):
    response = client.post("/auth/guest")
    assert response.status_code == 201
    body = response.json()
    assert body["user"]["method"] == "guest"
    token = body["token"]
    session = client.post("/sessions", headers=bearer(token)).json()["session_id"]
    identity = client.get("/identity", headers=bearer(token)).json()
    assert identity["authentication"] == "user" and identity["user"]["method"] == "guest"
    assert identity["can_use_server_managed_keys"] is False
    # Another user's token cannot see this guest's session.
    assert client.get(f"/sessions/{session}", headers=auth(TOKEN)).status_code == 404


def test_email_register_login_and_password_rules(client):
    data = {"email": "  Person@Example.com ", "password": "correct horse", "name": "Person"}
    created = client.post("/auth/register", json=data)
    assert created.status_code == 201
    assert created.json()["user"]["email"] == "person@example.com"
    assert "password" not in created.text and "scrypt" not in created.text
    assert client.post("/auth/register", json=data).json()["code"] == "email_taken"
    assert client.post("/auth/register", json={**data, "email": "x@example.com", "password": "short"}).status_code == 422
    assert client.post("/auth/register", json={**data, "email": "not-an-email"}).status_code == 422

    login = client.post("/auth/login", json={"email": "person@example.com", "password": "correct horse"})
    assert login.status_code == 200
    assert client.get("/identity", headers=bearer(login.json()["token"])).json()["user"]["email"] == "person@example.com"
    wrong = client.post("/auth/login", json={"email": "person@example.com", "password": "wrong password"})
    assert wrong.status_code == 401 and wrong.json()["code"] == "invalid_credentials"
    unknown = client.post("/auth/login", json={"email": "nobody@example.com", "password": "whatever"})
    assert unknown.status_code == 401


def test_failed_logins_are_throttled(client, monkeypatch):
    monkeypatch.setattr(accounts, "FAILURE_LIMIT", 3)
    accounts._failures.clear()
    client.post("/auth/register", json={"email": "slow@example.com", "password": "correct horse"})
    for _ in range(3):
        assert client.post("/auth/login", json={"email": "slow@example.com", "password": "nope-nope"}).status_code == 401
    blocked = client.post("/auth/login", json={"email": "slow@example.com", "password": "correct horse"})
    assert blocked.status_code == 429
    accounts._failures.clear()


def test_logout_revokes_token(client):
    token = client.post("/auth/guest").json()["token"]
    assert client.get("/sessions", headers=bearer(token)).status_code == 200
    assert client.post("/auth/logout", headers=bearer(token)).status_code == 200
    assert client.get("/sessions", headers=bearer(token)).status_code == 401


def test_google_sign_in_requires_configuration_and_verified_email(client, monkeypatch):
    payload = {"credential": "x" * 40}
    assert client.post("/auth/google", json=payload).json()["code"] == "google_unavailable"
    monkeypatch.setattr(settings, "google_client_id", "test-client.apps.googleusercontent.com")
    claims = {"sub": "google-123", "email": "g@example.com", "email_verified": True, "name": "G User"}
    monkeypatch.setattr(accounts, "verify_google_credential", lambda _credential: claims)
    first = client.post("/auth/google", json=payload)
    assert first.status_code == 200 and first.json()["user"]["method"] == "google"
    again = client.post("/auth/google", json=payload)
    assert again.json()["user"]["id"] == first.json()["user"]["id"]
    monkeypatch.setattr(accounts, "verify_google_credential", lambda _credential: {**claims, "sub": "other", "email_verified": False})
    assert client.post("/auth/google", json=payload).status_code == 401


def test_admin_login_is_separate_and_sees_user_list(client):
    client.post("/auth/guest")
    client.post("/auth/register", json={"email": "listed@example.com", "password": "correct horse"})
    assert client.post("/admin/login", json={**ADMIN, "password": "wrong"}).status_code == 401
    # A normal user's credentials never work on the admin sign-in.
    assert client.post("/admin/login", json={"username": "listed@example.com", "password": "correct horse"}).status_code == 401
    admin = client.post("/admin/login", json=ADMIN)
    assert admin.status_code == 200
    token = admin.json()["token"]

    identity = client.get("/identity", headers=bearer(token)).json()
    assert identity["authentication"] == "admin" and identity["can_use_server_managed_keys"] is True
    report = client.get("/admin/users", headers=bearer(token))
    assert report.status_code == 200
    data = report.json()
    emails = {user["email"] for user in data["users"]}
    assert "listed@example.com" in emails
    assert data["summary"]["total_users"] == len(data["users"])
    assert data["summary"]["guests"] >= 1 and data["summary"]["email"] >= 3
    assert all("password_hash" not in user for user in data["users"])
    assert client.get("/logs", headers=bearer(token)).status_code == 200


def test_regular_users_cannot_reach_admin_routes(client):
    assert client.get("/admin/users", headers=auth(TOKEN)).status_code == 403
    assert client.get("/admin/users").status_code == 401
    assert client.get("/admin/users", headers=auth(ADMIN_TOKEN)).status_code == 401
    assert client.get("/logs", headers=auth(TOKEN)).status_code == 401
