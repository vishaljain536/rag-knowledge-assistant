import hmac
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from typing import Literal

from fastapi import Request
from sqlalchemy import delete, select

from .db import SessionLocal
from .models import AuthToken
from .settings import TOKEN_PATTERN, settings

ADMIN_WORKSPACE = "_admin"
USER_TOKEN_TTL = timedelta(days=30)
ADMIN_TOKEN_TTL = timedelta(hours=12)


@dataclass(frozen=True)
class AuthContext:
    workspace: str
    authentication: Literal["user", "admin", "operator"]
    user_id: str | None = None

    @property
    def can_use_server_managed_keys(self) -> bool:
        return self.authentication == "admin"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def digest(token: str) -> str:
    return sha256(token.encode("ascii")).hexdigest()


def user_workspace(user_id: str) -> str:
    return f"u-{user_id}"


def issue_token(kind: Literal["user", "admin"], user_id: str | None = None) -> str:
    token = token_urlsafe(32)
    ttl = ADMIN_TOKEN_TTL if kind == "admin" else USER_TOKEN_TTL
    with SessionLocal.begin() as db:
        db.execute(delete(AuthToken).where(AuthToken.expires_at < utcnow()))
        db.add(AuthToken(digest=digest(token), kind=kind, user_id=user_id, expires_at=utcnow() + ttl))
    return token


def revoke_token(token: str) -> None:
    with SessionLocal.begin() as db:
        db.execute(delete(AuthToken).where(AuthToken.digest == digest(token)))


def bearer(request: Request) -> str | None:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not TOKEN_PATTERN.fullmatch(token):
        return None
    return token


def admin_credentials_valid(username: str, password: str) -> bool:
    valid_user = hmac.compare_digest(username.encode(), settings.admin_username.encode())
    valid_password = hmac.compare_digest(password.encode(), settings.demo_admin_password.get_secret_value().encode())
    return valid_user and valid_password


def authorize(request: Request, *, operator: bool) -> AuthContext | None:
    token = bearer(request)
    if token is None:
        return None
    if operator:
        expected = settings.admin_token
        if expected and hmac.compare_digest(digest(token), digest(expected.get_secret_value())):
            return AuthContext("operator", "operator")
    with SessionLocal() as db:
        row = db.scalar(select(AuthToken).where(AuthToken.digest == digest(token), AuthToken.expires_at > utcnow()))
    if row is None:
        return None
    if row.kind == "admin":
        return AuthContext("operator", "operator") if operator else AuthContext(ADMIN_WORKSPACE, "admin")
    if operator or row.user_id is None:
        return None
    return AuthContext(user_workspace(row.user_id), "user", row.user_id)
