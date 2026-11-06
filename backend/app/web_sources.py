import ipaddress
import socket
import ssl
from hashlib import sha256
from time import monotonic
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from langchain_core.documents import Document
from urllib3 import HTTPSConnectionPool, Timeout
from urllib3.exceptions import HTTPError

from .documents import ExtractedSource, MAX_TEXT_CHARS
from .errors import ApiError
from .settings import HOST_PATTERN, settings


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_HEADER_BYTES = 32 * 1024


def _blocked() -> ApiError:
    return ApiError(422, "url_blocked", "Use an approved public HTTPS URL.")


def _public_address(host: str) -> str:
    answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    addresses = [ipaddress.ip_address(answer[4][0]) for answer in answers]
    if not addresses or any(
        not address.is_global or address.is_multicast or address.is_reserved
        for address in addresses
    ):
        raise _blocked()
    return str(addresses[0])


def extract_url(url: str) -> ExtractedSource:
    try:
        parsed = urlsplit(url)
    except ValueError as exc:
        raise _blocked() from exc
    host = parsed.netloc.lower()
    if (
        parsed.scheme != "https" or not HOST_PATTERN.fullmatch(host) or "." not in host
        or host not in settings.allowed_url_hosts or parsed.fragment
        or any(ord(char) <= 32 for char in url)
    ):
        raise _blocked()
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query

    try:
        address = _public_address(host)
        # Connect to the checked address while verifying TLS for the original hostname.
        with HTTPSConnectionPool(
            address, server_hostname=host, assert_hostname=host,
            ssl_context=ssl.create_default_context(),
            timeout=Timeout(connect=4, read=5, total=12),
        ) as pool:
            deadline = monotonic() + 12
            with pool.request(
                "GET", path, headers={"Host": host, "Accept-Encoding": "identity"},
                redirect=False, retries=False, preload_content=False,
            ) as response:
                if response.status != 200:
                    raise ApiError(422, "url_response", "The URL must return a page directly with HTTP 200.")
                if sum(len(key) + len(value) + 4 for key, value in response.headers.items()) > MAX_HEADER_BYTES:
                    raise ApiError(422, "url_response", "The URL response headers are too large.")
                if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise ApiError(422, "url_response", "Compressed responses are unavailable for URL import.")
                kind = response.headers.get("Content-Type", "").partition(";")[0].strip().lower()
                if kind not in {"text/html", "text/plain"}:
                    raise ApiError(415, "url_content_type", "The URL must return HTML or plain text.")
                body = bytearray()
                for chunk in response.stream(16 * 1024, decode_content=False):
                    if monotonic() > deadline:
                        raise ApiError(504, "url_timeout", "The URL import timed out.")
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ApiError(413, "url_too_large", "The URL response exceeds 2 MiB.")
    except (OSError, HTTPError) as exc:
        raise ApiError(502, "url_fetch_failed", "The approved page could not be downloaded.") from exc

    if kind == "text/html":
        soup = BeautifulSoup(bytes(body), "html.parser")
        for unwanted in soup(["script", "style", "nav", "footer", "noscript"]):
            unwanted.decompose()
        text = soup.get_text(" ", strip=True)
    else:
        text = body.decode("utf-8", errors="replace").strip()
    if not text:
        raise ApiError(422, "empty_source", "No text was found at this URL.")
    if len(text) > MAX_TEXT_CHARS:
        raise ApiError(413, "source_too_complex", "The source exceeds the extraction limits.")
    # Keep signed links and query parameters out of source labels and model prompts.
    label = ("https://" + host + (parsed.path or "/"))[:512]
    source_id = sha256(url.encode() + b"\0" + text.encode()).hexdigest()
    return ExtractedSource(source_id, label, [Document(page_content=text)])
