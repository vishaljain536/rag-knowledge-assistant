from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings


def test_demo_login_is_opt_in_loopback_and_workspace_only(client, monkeypatch):
    credentials = {"username": "admin", "password": "BBRVY5"}
    origin = {"Origin": "http://127.0.0.1:5173"}
    with TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 54000)) as local:
        monkeypatch.setattr(settings, "enable_local_demo_login", False)
        assert local.post("/preview/login", json=credentials, headers=origin).status_code == 404
        monkeypatch.setattr(settings, "enable_local_demo_login", True)
        assert client.post("/preview/login", json=credentials).status_code == 404
        assert local.post("/preview/login", json=credentials, headers={"Origin": "https://example.test"}).status_code == 404
        invalid = local.post("/preview/login", json={**credentials, "password": "invalid"}, headers=origin)
        assert invalid.status_code == 401
        response = local.post("/preview/login", json=credentials, headers=origin)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        bearer = {**origin, "Authorization": f"Bearer {response.json()['token']}"}
        assert local.post("/sessions", headers=bearer).status_code == 201
        assert local.get("/logs", headers=bearer).status_code == 401
        assert client.get("/sessions", headers=bearer).status_code == 401
