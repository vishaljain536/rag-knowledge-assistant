import time
from contextlib import asynccontextmanager
from uuid import uuid4

from anyio import CapacityLimiter, WouldBlock
from fastapi import FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from starlette.datastructures import UploadFile

from . import corpora
from .access import authorize, demo_login, local_demo_allowed
from .db import SessionLocal, init_db
from .documents import MAX_FILES, MAX_FILE_BYTES, MAX_UPLOAD_BYTES, extract_upload
from .errors import ApiError
from .operational_logs import log_event, reset_request_id, set_request_id, store as log_store, stream_events
from .schemas import CONFIG_ERRORS, ChatRequest, ChatResponse, IndexSettings, IngestForm, IngestUrlRequest, ProviderSettings, SessionId
from .settings import settings
from .web_sources import extract_url


@asynccontextmanager
async def lifespan(application: FastAPI):
    init_db()
    application.state.ingest_slots = CapacityLimiter(4)
    log_event("info", "app.started", "Backend application started")
    yield
    log_event("info", "app.stopped", "Backend application stopped")


app = FastAPI(title="Global RAG Assistant API", version="2.0.0", lifespan=lifespan)


def _error(request: Request, status: int, code: str, message: str) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None
    return JSONResponse(
        {"code": code, "detail": message, "request_id": request.state.request_id},
        status_code=status, headers=headers,
    )


@app.exception_handler(ApiError)
async def expected_error(request: Request, exc: ApiError):
    return _error(request, exc.status_code, exc.code, exc.detail)


def _validation_error(exc: RequestValidationError | ValidationError) -> ApiError:
    # User input is present in both error types, including the whole provider object.
    first = exc.errors()[0]
    if first["type"] in CONFIG_ERRORS:
        return ApiError(422, "invalid_request", CONFIG_ERRORS[first["type"]])
    location = first.get("loc", ())
    field = location[-1] if location else None
    if field in {"session_id", "question", "model", "api_key", "chunk_size", "chunk_overlap", "url"}:
        return ApiError(422, "invalid_request", f"Check the value for {field}.")
    return ApiError(422, "invalid_request", "Check the request fields and provider configuration.")


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    return await expected_error(request, _validation_error(exc))


def _body_limit(request: Request) -> JSONResponse | None:
    if request.method != "POST":
        return None
    if request.headers.get("Transfer-Encoding") or "Content-Length" not in request.headers:
        return _error(request, 411, "length_required", "Send a request with a known content length.")
    try:
        length = int(request.headers["Content-Length"])
    except ValueError:
        return _error(request, 400, "invalid_length", "The content length is invalid.")
    if length < 0:
        return _error(request, 400, "invalid_length", "The content length is invalid.")
    maximum = MAX_UPLOAD_BYTES + 1024 * 1024 if request.url.path == "/ingest/files" else 256 * 1024
    if length > maximum:
        return _error(request, 413, "request_too_large", "The request exceeds the upload limit.")
    return None


@app.middleware("http")
async def request_boundary(request: Request, call_next):
    request_id = str(uuid4())
    token = set_request_id(request_id)
    request.state.request_id = request_id
    started = time.perf_counter()
    operator = request.url.path.rstrip("/") in {"/logs", "/logs/stream"}
    public = request.method == "GET" and request.url.path == "/health"
    demo = request.method == "POST" and request.url.path == "/preview/login"
    try:
        if demo:
            if local_demo_allowed(request):
                response = _body_limit(request)
                if response is None:
                    response = await call_next(request)
            else:
                response = _error(request, 404, "not_found", "Local preview sign-in is unavailable.")
        elif not public:
            workspace = authorize(request, operator=operator)
            if workspace is None:
                response = _error(request, 401, "unauthorized", "A valid access token is required.")
            else:
                request.state.workspace = workspace
                response = _body_limit(request)
                if response is None:
                    response = await call_next(request)
        else:
            response = await call_next(request)
    except Exception as exc:
        # An SDK exception may include a credential or provider request payload.
        log_event("error", "http.failed", "Request failed before a response was produced", error_type=type(exc).__name__)
        response = _error(request, 500, "internal_error", "The request could not be completed.")
    finally:
        reset_request_id(token)

    response.headers["X-Request-ID"] = request_id
    if not public:
        response.headers["Cache-Control"] = "no-store"
    if not operator:
        route = getattr(request.scope.get("route"), "path", "unmatched")
        log_event(
            "info" if response.status_code < 400 else "warning",
            "http.completed", "Request completed", request_id=request_id,
            method=request.method, route=route, status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
        )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


class DemoCredentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


@app.post("/preview/login", include_in_schema=False)
def preview_login(credentials: DemoCredentials):
    token = demo_login(credentials.username, credentials.password)
    if token is None:
        raise ApiError(401, "invalid_credentials", "The username or password is incorrect.")
    return {"token": token}


@app.get("/ready")
def ready():
    with SessionLocal() as db:
        db.execute(select(1))
    if not settings.data_dir.is_dir():
        raise ApiError(503, "storage_unavailable", "The corpus storage directory is unavailable.")
    return {"status": "ready"}


@app.get("/logs")
def logs(after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=500)):
    events = log_store.snapshot(after=after, limit=limit)
    return {"events": events, "latest_sequence": log_store.latest_sequence}


@app.get("/logs/stream")
async def logs_stream(request: Request, after: int = Query(default=0, ge=0), replay: int = Query(default=50, ge=1, le=100)):
    return StreamingResponse(
        stream_events(request, after=after, replay=replay),
        media_type="text/event-stream", headers={"X-Accel-Buffering": "no"},
    )


@app.post("/sessions", status_code=201)
def create_session(request: Request):
    return corpora.create_session(request.state.workspace)


@app.get("/sessions")
def list_sessions(request: Request):
    return corpora.list_sessions(request.state.workspace)


@app.get("/sessions/{session_id}")
def session_state(request: Request, session_id: SessionId):
    return corpora.session_state(request.state.workspace, session_id)


def _ingest_files(workspace: str, session_id: str, provider: ProviderSettings, index: IndexSettings | None, files: list[UploadFile]):
    def extract():
        sources = []
        total = 0
        for file in files:
            content = file.file.read(MAX_FILE_BYTES + 1)
            total += len(content)
            if total > MAX_UPLOAD_BYTES:
                raise ApiError(413, "request_too_large", "Files may total at most 48 MiB per upload.")
            sources.append(extract_upload(file.filename or "", content))
        return sources

    return corpora.ingest(workspace, session_id, provider, index, extract)


@app.post("/ingest/files")
async def ingest_files(request: Request):
    limiter = request.app.state.ingest_slots
    try:
        limiter.acquire_nowait()
    except WouldBlock as exc:
        raise ApiError(429, "ingest_busy", "Too many imports are running. Try again shortly.") from exc
    try:
        async with request.form(max_files=MAX_FILES, max_fields=3, max_part_size=32 * 1024) as form:
            files = form.getlist("files")
            if not files or any(not isinstance(file, UploadFile) for file in files):
                raise ApiError(422, "files_required", "Select one or more supported files.")
            for file in files:
                if file.size is not None and file.size > MAX_FILE_BYTES:
                    raise ApiError(413, "file_too_large", "Each file must be at most 25 MiB.")
            try:
                # This small form model validates the UUID and hides raw multipart inputs in errors.
                values = IngestForm.model_validate(dict(form))
                provider = ProviderSettings.model_validate_json(values.provider_json)
                index = IndexSettings.model_validate_json(values.index_json) if values.index_json else None
            except ValidationError as exc:
                raise _validation_error(exc) from exc
            return await run_in_threadpool(_ingest_files, request.state.workspace, values.session_id, provider, index, files)
    finally:
        limiter.release()


@app.post("/ingest/url")
async def ingest_url(payload: IngestUrlRequest, request: Request):
    if not settings.enable_url_ingestion:
        raise ApiError(503, "url_disabled", "URL ingestion is disabled on this deployment.")
    limiter = request.app.state.ingest_slots
    try:
        limiter.acquire_nowait()
    except WouldBlock as exc:
        raise ApiError(429, "ingest_busy", "Too many imports are running. Try again shortly.") from exc
    try:
        return await run_in_threadpool(
            corpora.ingest, request.state.workspace, payload.session_id, payload.provider, payload.index,
            lambda: [extract_url(payload.url)],
        )
    finally:
        limiter.release()


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, request: Request):
    return corpora.chat(request.state.workspace, payload)


@app.get("/conversations/{session_id}")
def conversations(session_id: SessionId, request: Request):
    return corpora.conversation(request.state.workspace, session_id)
