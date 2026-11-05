import asyncio
import json
import re
from collections import deque
from contextvars import ContextVar
from datetime import datetime, timezone
from threading import Lock
from typing import Any

_MAX_ENTRIES = 500
_MAX_VALUE_LENGTH = 300
_SENSITIVE_KEY_PARTS = ("api_key", "access_key", "authorization", "cookie", "password", "secret", "token")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


class OperationalLogStore:
    def __init__(self, max_entries: int = _MAX_ENTRIES):
        self._entries: deque[dict[str, Any]] = deque(maxlen=max_entries)
        self._sequence = 0
        self._lock = Lock()

    @property
    def latest_sequence(self) -> int:
        with self._lock:
            return self._sequence

    def append(
        self,
        level: str,
        event: str,
        message: str,
        *,
        request_id: str | None = None,
        **details: Any,
    ) -> dict[str, Any]:
        safe_details = {
            str(key): _safe_value(key, value)
            for key, value in details.items()
            if value is not None
        }
        with self._lock:
            self._sequence += 1
            entry = {
                "sequence": self._sequence,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": _safe_text(level, 16),
                "event": _safe_text(event, 80),
                "message": _safe_text(message, _MAX_VALUE_LENGTH),
                "request_id": request_id or _request_id.get(),
                "details": safe_details,
            }
            self._entries.append(entry)
            return dict(entry)

    def snapshot(self, *, after: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(limit, _MAX_ENTRIES))
        with self._lock:
            matching = [entry for entry in self._entries if entry["sequence"] > after]
            return [dict(entry) for entry in matching[-bounded_limit:]]


store = OperationalLogStore()


def set_request_id(value: str):
    return _request_id.set(value)


def reset_request_id(token) -> None:
    _request_id.reset(token)


def log_event(level: str, event: str, message: str, **details: Any) -> dict[str, Any]:
    return store.append(level, event, message, **details)


async def stream_events(request, *, after: int = 0, replay: int = 50):
    cursor = after
    if cursor == 0:
        cursor = max(0, store.latest_sequence - max(1, min(replay, 100)))
    idle_ticks = 0
    while not await request.is_disconnected():
        entries = store.snapshot(after=cursor, limit=100)
        if entries:
            idle_ticks = 0
            for entry in entries:
                cursor = entry["sequence"]
                payload = json.dumps(entry, separators=(",", ":"), ensure_ascii=False)
                yield f"id: {cursor}\nevent: log\ndata: {payload}\n\n"
        else:
            idle_ticks += 1
            if idle_ticks >= 15:
                idle_ticks = 0
                yield ": keep-alive\n\n"
        await asyncio.sleep(1)


def _safe_value(key: object, value: Any) -> Any:
    key_text = str(key).lower()
    if any(part in key_text for part in _SENSITIVE_KEY_PARTS):
        return "[REDACTED]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _safe_text(value, _MAX_VALUE_LENGTH)
    if isinstance(value, (list, tuple)):
        return [_safe_value(key, item) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(child_key): _safe_value(child_key, child_value)
            for child_key, child_value in list(value.items())[:20]
        }
    return _safe_text(type(value).__name__, 80)


def _safe_text(value: object, limit: int) -> str:
    text = _CONTROL_CHARACTERS.sub("", str(value)).replace("\r", " ").replace("\n", " ")
    return text[:limit]
