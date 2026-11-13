import base64
import hashlib
import hmac
import re
import time
from collections import defaultdict, deque
from datetime import timedelta
from threading import Lock
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from .access import issue_token, user_workspace, utcnow
from .db import SessionLocal
from .errors import ApiError
from .models import RagSession, User
from .settings import settings

EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


class EmailCredentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address.")
        return value


class Registration(EmailCredentials):
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=80)


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=20, max_length=8192)


class AdminCredentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


# Small in-process throttle for repeated failed sign-ins on one account.
_failures: dict[str, deque[float]] = defaultdict(deque)
_failure_lock = Lock()
FAILURE_LIMIT = 10
FAILURE_WINDOW_SECONDS = 600


def _throttled(key: str) -> bool:
    now = time.monotonic()
    with _failure_lock:
        attempts = _failures[key]
        while attempts and now - attempts[0] > FAILURE_WINDOW_SECONDS:
            attempts.popleft()
        return len(attempts) >= FAILURE_LIMIT


def _record_failure(key: str) -> None:
    with _failure_lock:
        _failures[key].append(time.monotonic())


def _clear_failures(key: str) -> None:
    with _failure_lock:
        _failures.pop(key, None)


def check_throttle(key: str) -> None:
    if _throttled(key):
        raise ApiError(429, "too_many_attempts", "Too many failed sign-in attempts. Try again in a few minutes.")


def hash_password(password: str) -> str:
    salt = hashlib.sha256(uuid4().bytes).digest()[:16]
    derived = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    encode = lambda raw: base64.b64encode(raw).decode()
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${encode(salt)}${encode(derived)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32,
        )
        return hmac.compare_digest(derived, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


def user_view(user: User) -> dict:
    return {"id": user.id, "method": user.method, "email": user.email, "name": user.name}


def _signed_in(db, user: User) -> dict:
    user.login_count = (user.login_count or 0) + 1
    user.last_login_at = utcnow()
    view = user_view(user)
    db.commit()
    return {"token": issue_token("user", view["id"]), "user": view}


def create_guest() -> dict:
    with SessionLocal() as db:
        user = User(id=str(uuid4()), method="guest", name="Guest")
        db.add(user)
        db.flush()
        return _signed_in(db, user)


def register(data: Registration) -> dict:
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == data.email)):
            raise ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.")
        name = (data.name or "").strip() or data.email.split("@")[0]
        user = User(id=str(uuid4()), method="email", email=data.email, name=name, password_hash=hash_password(data.password))
        db.add(user)
        try:
            db.flush()
        except IntegrityError as exc:
            raise ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.") from exc
        return _signed_in(db, user)


def email_login(data: EmailCredentials) -> dict:
    key = f"email:{data.email}"
    check_throttle(key)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == data.email))
        if user is None or not verify_password(data.password, user.password_hash):
            _record_failure(key)
            raise ApiError(401, "invalid_credentials", "The email or password is incorrect.")
        _clear_failures(key)
        return _signed_in(db, user)


def verify_google_credential(credential: str) -> dict:
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), settings.google_client_id)
    except ValueError as exc:
        raise ApiError(401, "invalid_google_credential", "Google sign-in could not be verified.") from exc
    return claims


def google_login(data: GoogleCredential) -> dict:
    if not settings.google_client_id:
        raise ApiError(503, "google_unavailable", "Google sign-in is not configured on this deployment.")
    claims = verify_google_credential(data.credential)
    subject = claims.get("sub")
    email = (claims.get("email") or "").strip().lower() or None
    if not subject or not claims.get("email_verified"):
        raise ApiError(401, "invalid_google_credential", "Google sign-in requires a verified email address.")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.google_sub == subject))
        if user is None and email:
            # A verified Google email may join an existing email account with the same address.
            user = db.scalar(select(User).where(User.email == email))
            if user is not None:
                user.google_sub = subject
        if user is None:
            user = User(id=str(uuid4()), method="google", email=email, name=(claims.get("name") or "")[:80] or None, google_sub=subject)
            db.add(user)
            db.flush()
        return _signed_in(db, user)


def admin_users() -> dict:
    now = utcnow()
    with SessionLocal() as db:
        users = db.scalars(select(User).order_by(User.created_at.desc(), User.id).limit(500)).all()
        sessions = dict(db.execute(select(RagSession.workspace, func.count()).group_by(RagSession.workspace)).all())
        total = db.scalar(select(func.count()).select_from(User)) or 0
        by_method = dict(db.execute(select(User.method, func.count()).group_by(User.method)).all())
        logins = db.scalar(select(func.coalesce(func.sum(User.login_count), 0))) or 0
        active = db.scalar(select(func.count()).select_from(User).where(User.last_login_at >= now - timedelta(hours=24))) or 0
        new = db.scalar(select(func.count()).select_from(User).where(User.created_at >= now - timedelta(days=7))) or 0

    iso = lambda value: value.isoformat() + "Z" if value else None
    return {
        "summary": {
            "total_users": total,
            "guests": by_method.get("guest", 0),
            "email": by_method.get("email", 0),
            "google": by_method.get("google", 0),
            "total_logins": logins,
            "active_last_24h": active,
            "new_last_7d": new,
        },
        "users": [{
            **user_view(user),
            "created_at": iso(user.created_at),
            "last_login_at": iso(user.last_login_at),
            "login_count": user.login_count or 0,
            "sessions": sessions.get(user_workspace(user.id), 0),
        } for user in users],
    }
