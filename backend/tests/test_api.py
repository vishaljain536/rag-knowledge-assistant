import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from app import corpora, graph, rag
from app.settings import settings

from conftest import ADMIN_TOKEN, OTHER_TOKEN, PROVIDER, ask, auth, new_session, upload


def test_access_and_redaction(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready", headers=auth()).status_code == 200
    assert client.post("/sessions").status_code == 401
    assert client.get("/logs", headers=auth()).status_code == 401
    assert client.get("/logs/stream", headers=auth()).status_code == 401
    assert client.get("/logs", headers=auth(ADMIN_TOKEN)).status_code == 200
    assert client.get("/sessions", headers=auth(ADMIN_TOKEN)).status_code == 401
    session_id = new_session(client)
    assert client.get("/sessions", headers=auth(OTHER_TOKEN)).json() == []
    assert client.get(f"/sessions/{session_id}", headers=auth(OTHER_TOKEN)).status_code == 404
    assert client.get(f"/conversations/{session_id}", headers=auth(OTHER_TOKEN)).status_code == 404
    assert upload(client, session_id, "alpha.txt", b"alpha", token=OTHER_TOKEN).status_code == 404
    assert ask(client, session_id, "hello", token=OTHER_TOKEN).status_code == 404
    assert client.get("/sessions/invalid", headers=auth()).status_code == 422

    response = ask(client, session_id, "secret-question", provider={"provider": "groq", **PROVIDER})
    assert response.status_code == 422 and response.json()["code"] == "invalid_request"
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
    assert PROVIDER["api_key"] not in response.text
    response = upload(client, session_id, "alpha.txt", b"alpha", provider={"provider": "groq", **PROVIDER})
    assert response.status_code == 422 and PROVIDER["api_key"] not in response.text
    events = client.get("/logs", headers=auth(ADMIN_TOKEN)).text
    assert PROVIDER["api_key"] not in events and "secret-question" not in events


def test_upload_limits_and_input_format(client):
    session_id = new_session(client)
    assert upload(client, session_id, "fake.png", b"fake").status_code == 415
    assert upload(client, session_id, "legacy.xls", b"fake").status_code == 415
    assert upload(client, session_id, "binary.txt", b"\x00\xff").status_code == 422
    assert upload(client, session_id, "empty.txt", b"   ").json()["code"] == "empty_source"
    assert upload(client, session_id, "fake.xlsx", b"not a zip").json()["code"] == "invalid_file"
    assert upload(client, session_id, "bad-size.txt", b"text", index={"chunk_size": 200, "chunk_overlap": 200}).status_code == 422
    assert upload(client, session_id, "alpha.txt", b"alpha", index={"pinecone_namespace": "other"}).status_code == 422
    assert client.post("/ingest/files", headers={**auth(), "Content-Length": str(50 * 1024**2)}).status_code == 413
    assert client.post("/ingest/files", headers={**auth(), "Transfer-Encoding": "chunked"}).status_code == 411
    form = {"session_id": session_id, "provider_json": json.dumps(PROVIDER)}
    files = [("files", (f"{number}.txt", b"content")) for number in range(9)]
    assert client.post("/ingest/files", headers=auth(), data=form, files=files).status_code == 400
    assert client.get(f"/sessions/{session_id}", headers=auth()).json()["sources"] == []


@pytest.mark.parametrize("store", ["faiss", "chroma"])
def test_append_dedupe_and_restore(client, store):
    session_id = new_session(client)
    alpha = b"Alpha policy allows 42 units."
    index = {"vector_store": store}
    assert upload(client, session_id, "alpha.txt", alpha, index=index).json()["chunks"] == 1
    assert upload(client, session_id, "beta.txt", b"Beta policy allows 91 units.").json()["chunks"] == 1
    assert upload(client, session_id, "alpha-copy.txt", alpha).json()["chunks"] == 0
    session = client.get(f"/sessions/{session_id}", headers=auth()).json()
    assert {source["label"] for source in session["sources"]} == {"alpha.txt", "beta.txt"}
    assert session["profile"]["index"]["vector_store"] == store
    for label in ("alpha", "beta"):
        response = ask(client, session_id, f"{label} policy")
        assert response.status_code == 200, response.text
        assert [cite["source"] for cite in response.json()["citations"]] == [f"{label}.txt"]
    assert len(client.get(f"/conversations/{session_id}", headers=auth()).json()) == 4


def test_faiss_concurrent_writes_and_failed_publish(client, monkeypatch):
    session_id = new_session(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(upload, client, session_id, "alpha.txt", b"Alpha policy")
        b = pool.submit(upload, client, session_id, "beta.txt", b"Beta policy")
        assert a.result().status_code == b.result().status_code == 200
    state = client.get(f"/sessions/{session_id}", headers=auth()).json()
    assert {source["label"] for source in state["sources"]} == {"alpha.txt", "beta.txt"}

    def fail(*_):
        raise OSError("simulated failure")

    monkeypatch.setattr(rag, "save_faiss", fail)
    assert upload(client, session_id, "new.txt", b"New document").status_code == 502
    assert client.get(f"/sessions/{session_id}", headers=auth()).json() == state
    assert ask(client, session_id, "alpha policy").json()["citations"][0]["source"] == "alpha.txt"
    snapshot = next(rag.store_path(session_id).glob("*.index"))
    snapshot.write_bytes(snapshot.read_bytes() + b"tampered")
    assert ask(client, session_id, "alpha policy").json()["code"] == "index_unavailable"


def test_chat_failures_and_embedding_profile(client, monkeypatch):
    session_id = new_session(client)
    assert ask(client, session_id, "Where is the policy?").json()["code"] == "empty_corpus"
    assert client.get(f"/conversations/{session_id}", headers=auth()).json() == []
    assert ask(client, session_id, "Hello!").json()["citations"] == []
    assert upload(client, session_id, "alpha.txt", b"Alpha policy", index={"chunk_size": 400}).status_code == 200
    assert ask(client, session_id, "Alpha policy", provider={**PROVIDER, "embedding_model": "another-model"}).json()["code"] == "corpus_settings_mismatch"
    assert upload(client, session_id, "beta.txt", b"beta", index={"chunk_size": 401}).json()["code"] == "corpus_settings_mismatch"
    assert ask(client, session_id, "Alpha policy", provider={**PROVIDER, "model": "another-chat-model"}).status_code == 200
    assert ask(client, session_id, "Question not covered").json()["answer"] == graph.NO_EVIDENCE

    class BrokenModel:
        def invoke(self, _):
            raise ValueError(PROVIDER["api_key"])

    monkeypatch.setattr(graph, "chat_model", lambda *_: BrokenModel())
    response = ask(client, session_id, "Alpha policy")
    assert response.status_code == 502 and PROVIDER["api_key"] not in response.text
    assert len(client.get(f"/conversations/{session_id}", headers=auth()).json()) == 6

    class WrongDimension:
        def embed_query(self, _):
            return [1.0]

    monkeypatch.setattr(corpora, "embeddings", lambda *_: WrongDimension())
    assert ask(client, session_id, "Alpha policy").json()["code"] == "embedding_dimension"


def test_follow_up_and_citation_validation(client, monkeypatch):
    session_id = new_session(client)
    assert upload(client, session_id, "alpha.txt", b"Alpha policy").status_code == 200
    assert upload(client, session_id, "beta.txt", b"Beta policy").status_code == 200
    assert ask(client, session_id, "Alpha policy").status_code == 200
    prompts = []

    class Model:
        def invoke(self, messages):
            payload = json.loads(messages[-1].content)
            prompts.append(payload)
            return SimpleNamespace(content="Alpha policy cost" if "prior_questions" in payload else "Valid citation [2].")

    monkeypatch.setattr(graph, "chat_model", lambda *_: Model())
    response = ask(client, session_id, "How much does it cost?")
    assert response.status_code == 200, response.text
    assert prompts[0]["prior_questions"] == ["Alpha policy"]
    assert prompts[1]["question"] == "Alpha policy cost"
    assert prompts[1]["passages"][0]["source"] == "alpha.txt"
    assert response.json()["citations"][0]["number"] == 2
    assert response.json()["citations"][0]["source"] == "beta.txt"
    monkeypatch.setattr(Model, "invoke", lambda *_: SimpleNamespace(content="Unsupported answer [99]."))
    assert ask(client, session_id, "Alpha policy").json() == {"answer": graph.NO_EVIDENCE, "citations": []}


def test_url_is_opt_in_and_azure_endpoints_are_approved(client):
    session_id = new_session(client)
    response = client.post("/ingest/url", headers=auth(), json={
        "session_id": session_id, "url": "https://example.org", "provider": PROVIDER,
    })
    assert response.json()["code"] == "url_disabled"
    azure = {
        "provider": "azure_openai", "embedding_provider": "azure_openai", **PROVIDER,
        "azure_deployment": "chat-deployment", "azure_embedding_deployment": "embed-deployment",
        "azure_endpoint": "https://approved.openai.azure.com",
    }
    assert upload(client, session_id, "alpha.txt", b"alpha", provider=azure).status_code == 200
    assert ask(client, session_id, "alpha", provider={**azure, "azure_endpoint": "http://127.0.0.1"}).status_code == 422
    assert ask(client, session_id, "alpha", provider={**azure, "azure_embedding_deployment": "new-embed"}).status_code == 409


def test_pinecone_resources_are_server_owned(client, monkeypatch):
    from langchain_pinecone import PineconeVectorStore

    monkeypatch.setattr(settings, "pinecone_index", "server-approved-index")
    calls = []
    documents = {}

    def fake_init(self, *, index_name, embedding, namespace):
        calls.append((index_name, namespace))
        self.namespace = namespace
        self.embedder = embedding

    def fake_add(self, docs, *, ids):
        self.embedder.embed_documents([doc.page_content for doc in docs])
        documents[self.namespace] = docs

    def fake_query(self, _, *, k, filter):
        assert k == 5
        return [doc for doc in documents[self.namespace] if doc.metadata["source_id"] in filter["source_id"]["$in"]]

    monkeypatch.setattr(PineconeVectorStore, "__init__", fake_init)
    monkeypatch.setattr(PineconeVectorStore, "add_documents", fake_add)
    monkeypatch.setattr(PineconeVectorStore, "similarity_search", fake_query)
    for name in ("alpha", "beta"):
        session_id = new_session(client)
        assert upload(client, session_id, name + ".txt", name.encode(), index={"vector_store": "pinecone"}).status_code == 200
        assert ask(client, session_id, name).json()["citations"][0]["source"] == name + ".txt"
        assert calls[-2:] == [("server-approved-index", f"corpus-{session_id}")] * 2
    assert calls[0] != calls[-1]
