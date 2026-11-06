import hmac
from hashlib import sha256
from secrets import token_urlsafe

from fastapi import Request

from .settings import TOKEN_PATTERN, settings


_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_DEMO_WORKSPACE = "_local-demo"
_DEMO_TOKEN = token_urlsafe(32)
_HOSTED_DEMO_TOKEN = token_urlsafe(32)


def local_demo_allowed(request: Request) -> bool:
    origin = request.headers.get("origin")
    return (
        settings.enable_local_demo_login
        and request.client is not None
        and request.client.host in _LOCAL_HOSTS
        and request.url.hostname in _LOCAL_HOSTS
        and origin in {None, "http://127.0.0.1:5173", "http://localhost:5173"}
    )


def hosted_demo_allowed(request: Request) -> bool:
    origin = settings.hosted_demo_origin
    password = settings.hosted_demo_password
    return bool(
        password and password.get_secret_value()
        and origin.startswith("https://")
        and request.headers.get("origin") == origin
    )


def demo_login(request: Request, username: str, password: str) -> str | None:
    valid_user = hmac.compare_digest(username.encode(), b"admin")
    if local_demo_allowed(request):
        expected_password, token = "BBRVY5", _DEMO_TOKEN
    elif hosted_demo_allowed(request) and settings.hosted_demo_password is not None:
        expected_password = settings.hosted_demo_password.get_secret_value()
        token = _HOSTED_DEMO_TOKEN
    else:
        return None
    valid_password = hmac.compare_digest(password.encode(), expected_password.encode())
    return token if valid_user and valid_password else None


def _digest(token: str) -> bytes:
    return sha256(token.encode("ascii")).digest()


def authorize(request: Request, *, operator: bool) -> str | None:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not TOKEN_PATTERN.fullmatch(token):
        return None
    received = _digest(token)
    if operator:
        expected = settings.admin_token
        if expected and hmac.compare_digest(received, _digest(expected.get_secret_value())):
            return "operator"
        return None
    if local_demo_allowed(request) and hmac.compare_digest(received, _digest(_DEMO_TOKEN)):
        return _DEMO_WORKSPACE
    if hosted_demo_allowed(request) and hmac.compare_digest(received, _digest(_HOSTED_DEMO_TOKEN)):
        return "_hosted-demo"
    match = None
    for workspace, configured in settings.workspace_tokens.items():
        if hmac.compare_digest(received, _digest(configured.get_secret_value())):
            match = workspace
    return match
