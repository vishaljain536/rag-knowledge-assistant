import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langchain_core.embeddings import Embeddings
from pydantic import SecretStr
from sqlalchemy import create_engine

from app import corpora, db, graph
from app.main import app
from app.settings import settings


TOKEN = "test_workspace_alpha_" + "a" * 32
OTHER_TOKEN = "test_workspace_beta_" + "b" * 32
ADMIN_TOKEN = "test_operator_" + "c" * 32
PROVIDER = {"api_key": "synthetic-provider-secret"}


def auth(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def new_session(client, token=TOKEN):
    response = client.post("/sessions", headers=auth(token))
    assert response.status_code == 201, response.text
    return response.json()["session_id"]


def upload(client, session_id, name, data, *, provider=PROVIDER, index=None, token=TOKEN):
    form = {"session_id": session_id, "provider_json": json.dumps(provider)}
    if index is not None:
        form["index_json"] = json.dumps(index)
    return client.post("/ingest/files", headers=auth(token), data=form, files={"files": (name, data)})


def ask(client, session_id, question, *, provider=PROVIDER, index=None, token=TOKEN):
    return client.post("/chat", headers=auth(token), json={
        "session_id": session_id, "question": question, "provider": provider, "index": index,
    })


class TestEmbeddings(Embeddings):
    def embed_documents(self, texts):
        return [self.embed_query(text) for text in texts]

    def embed_query(self, text):
        text = text.lower()
        return [float("alpha" in text), float("beta" in text), float("invoice-7" in text), 1.0]


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'app.db').as_posix()}")
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(db.SessionLocal, "kw", {**db.SessionLocal.kw, "bind": engine})
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "workspace_tokens", {"alpha": SecretStr(TOKEN), "beta": SecretStr(OTHER_TOKEN)})
    monkeypatch.setattr(settings, "admin_token", SecretStr(ADMIN_TOKEN))
    monkeypatch.setattr(settings, "demo_admin_password", SecretStr("demo-test-password"))
    monkeypatch.setattr(settings, "openai_api_key", SecretStr("server-openai-test-key"))
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr("server-gemini-test-key"))
    monkeypatch.setattr(settings, "anthropic_api_key", SecretStr("server-anthropic-test-key"))
    monkeypatch.setattr(settings, "enable_url_ingestion", False)
    monkeypatch.setattr(settings, "azure_allowed_endpoints", "https://approved.openai.azure.com")
    monkeypatch.setattr(settings, "pinecone_index", "")
    monkeypatch.setattr(corpora, "embeddings", lambda *_: TestEmbeddings())

    class Model:
        def invoke(self, messages):
            payload = json.loads(messages[-1].content)
            if "prior_questions" in payload:
                return SimpleNamespace(content="What is the alpha policy?")
            if "not covered" in payload["question"]:
                return SimpleNamespace(content="INSUFFICIENT_EVIDENCE")
            return SimpleNamespace(content="The selected passage has the answer [1].")

    monkeypatch.setattr(graph, "chat_model", lambda *_: Model())
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
