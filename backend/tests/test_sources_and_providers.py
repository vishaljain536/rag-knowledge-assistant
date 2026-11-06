import io
import socket

import pytest
from openpyxl import Workbook
from pypdf import PdfWriter

from app import providers, web_sources
from app.documents import extract_upload
from app.errors import ApiError
from app.schemas import IndexSettings, ProviderSettings
from app.settings import settings


def test_extraction_preserves_sheet_and_rejects_blank_pdf():
    workbook = Workbook()
    workbook.active.title = "Inventory"
    workbook.active.append(["ID", "Description"])
    workbook.active.append(["invoice-7", "Pump assembly"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    source = extract_upload("inventory.xlsx", buffer.getvalue())
    assert source.documents[0].metadata == {"sheet": "Inventory"}
    assert "invoice-7 | Pump assembly" in source.documents[0].page_content

    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(ApiError) as exc:
        extract_upload("no-text.pdf", buffer.getvalue())
    assert exc.value.code == "empty_source"


def test_gemini_embedding_default_constructs_supported_adapter():
    provider = ProviderSettings(provider="gemini", api_key="synthetic-key", embedding_provider="gemini")
    profile = providers.corpus_profile(provider, IndexSettings())
    embedder = providers.embeddings(provider, profile)
    assert profile.embedding_model == "gemini-embedding-001"
    assert embedder.model.removeprefix("models/") == profile.embedding_model


@pytest.mark.parametrize("private_ip", ["127.0.0.1", "10.42.0.1", "169.254.169.254", "::1", "fd00::1"])
def test_url_refuses_mixed_private_dns_results(monkeypatch, private_ip):
    monkeypatch.setattr(settings, "url_allowed_hosts", "approved.example")
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args, **_kw: [
        (None, None, None, None, ("93.184.215.14", 443)),
        (None, None, None, None, (private_ip, 443)),
    ])

    def no_connect(*_args, **_kw):
        pytest.fail("No outbound connection should be attempted")

    monkeypatch.setattr(web_sources, "HTTPSConnectionPool", no_connect)
    with pytest.raises(ApiError) as exc:
        web_sources.extract_url("https://approved.example/")
    assert exc.value.code == "url_blocked"


@pytest.mark.parametrize("url", [
    "http://approved.example/", "https://127.0.0.1/", "https://evil.example/",
    "https://approved.example@evil.example/", "https://user@approved.example/",
    "https://approved.example:444/",
])
def test_url_rejects_unapproved_origins_without_resolving(monkeypatch, url):
    monkeypatch.setattr(settings, "url_allowed_hosts", "approved.example")
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args, **_kw: pytest.fail("Must reject before DNS"))
    with pytest.raises(ApiError) as exc:
        web_sources.extract_url(url)
    assert exc.value.code == "url_blocked"


@pytest.mark.parametrize(("status", "chunks", "code"), [
    (302, [], "url_response"), (200, [b"x" * 64], "url_too_large"),
    (200, [b"<nav>Skip</nav><p>Indexed policy</p>"], None),
])
def test_url_uses_verified_ip_and_never_follows_redirects(monkeypatch, status, chunks, code):
    monkeypatch.setattr(settings, "url_allowed_hosts", "approved.example")
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args, **_kw: [
        (None, None, None, None, ("93.184.215.14", 443)),
    ])
    monkeypatch.setattr(web_sources, "MAX_RESPONSE_BYTES", 48)
    requests = []

    class FakeResponse:
        headers = {"Content-Type": "text/html", "Location": "https://127.0.0.1/"}

        def __enter__(self):
            self.status = status
            return self

        def __exit__(self, *_args):
            pass

        def stream(self, *_args, **_kwargs):
            yield from chunks

    class FakePool:
        def __init__(self, address, *, server_hostname, assert_hostname, **_kwargs):
            assert address == "93.184.215.14"
            assert server_hostname == assert_hostname == "approved.example"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def request(self, method, path, *, headers, redirect, **_kwargs):
            assert method == "GET" and headers["Host"] == "approved.example" and redirect is False
            requests.append(path)
            return FakeResponse()

    monkeypatch.setattr(web_sources, "HTTPSConnectionPool", FakePool)
    url = "https://approved.example/policy?key=private"
    if code:
        with pytest.raises(ApiError) as exc:
            web_sources.extract_url(url)
        assert exc.value.code == code
    else:
        source = web_sources.extract_url(url)
        assert source.label == "https://approved.example/policy"
        assert source.documents[0].page_content == "Indexed policy"
    assert requests == ["/policy?key=private"]
