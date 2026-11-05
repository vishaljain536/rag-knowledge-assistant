import json
import time
from contextlib import asynccontextmanager
from uuid import uuid4
from fastapi import Depends, FastAPI, File, Form, HTTPException, Path, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session
from .db import SessionLocal, init_db
from .documents import extract_upload, extract_url
from .graph import run_rag
from .models import Conversation, Message
from .operational_logs import log_event, reset_request_id, set_request_id, store as log_store, stream_events
from .rag import build_index
from .schemas import ChatRequest, ChatResponse, IndexSettings, IngestUrlRequest, ProviderSettings, SESSION_ID_PATTERN
from .settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log_event("info", "app.started", "Backend application started")
    yield
    log_event("info", "app.stopped", "Backend application stopped")


app = FastAPI(title="Global RAG Assistant API", version="1.1.0", lifespan=lifespan)


def _route_label(request: Request) -> str:
    route = request.scope.get("route")
    if route and getattr(route, "path", None):
        return route.path
    if request.url.path.startswith("/conversations/"):
        return "/conversations/{session_id}"
    return request.url.path


@app.middleware("http")
async def operational_logging(request: Request, call_next):
    request_id = str(uuid4())
    token = set_request_id(request_id)
    request.state.request_id = request_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        if not request.url.path.startswith("/logs"):
            log_event("error", "http.failed", "Request failed before a response was produced", method=request.method, route=_route_label(request), error_type=type(exc).__name__)
        reset_request_id(token)
        raise

    response.headers["X-Request-ID"] = request_id
    if not request.url.path.startswith("/logs"):
        log_event(
            "info" if response.status_code < 400 else "warning",
            "http.completed",
            "Request completed",
            method=request.method,
            route=_route_label(request),
            status=response.status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
        )
    reset_request_id(token)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Request-ID"],
)


def parse_form_settings(provider_json: str, index_json: str) -> tuple[ProviderSettings, IndexSettings]:
    try:
        return ProviderSettings.model_validate_json(provider_json), IndexSettings.model_validate_json(index_json)
    except ValidationError as exc:
        error = exc.errors()[0]
        field = ".".join(str(part) for part in error.get("loc", ())) or "configuration"
        raise HTTPException(status_code=422, detail=f"Invalid request configuration for {field}: {error['msg']}") from exc


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def save_message(db: Session, session_id: str, role: str, content: str, citations: list | None = None):
    conversation = db.query(Conversation).filter_by(session_id=session_id).first()
    if not conversation:
        conversation = Conversation(session_id=session_id, title=content[:80])
        db.add(conversation)
        db.flush()
    db.add(Message(conversation_id=conversation.id, role=role, content=content, citations_json=json.dumps(citations or [])))
    db.commit()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/logs")
def logs(after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=500)):
    events = log_store.snapshot(after=after, limit=limit)
    return {"events": events, "latest_sequence": log_store.latest_sequence}


@app.get("/logs/stream")
async def logs_stream(request: Request, after: int = Query(default=0, ge=0), replay: int = Query(default=50, ge=1, le=100)):
    return StreamingResponse(
        stream_events(request, after=after, replay=replay),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-store", "X-Accel-Buffering": "no"},
    )


@app.post("/ingest/files")
async def ingest_files(
    request: Request,
    session_id: str = Form(..., pattern=SESSION_ID_PATTERN),
    provider_json: str = Form(...),
    index_json: str = Form("{}"),
    files: list[UploadFile] = File(...),
):
    provider, index = parse_form_settings(provider_json, index_json)
    log_event("info", "ingest.started", "File ingestion started", files=len(files), provider=provider.provider, embedding_provider=provider.embedding_provider, vector_store=index.vector_store)
    docs = []
    for file in files:
        content = await file.read()
        if len(content) > 25 * 1024 * 1024:
            log_event("warning", "ingest.rejected", "File exceeded the upload limit", reason="file_too_large")
            raise HTTPException(413, f"{file.filename} is over the 25 MB upload limit.")
        docs.extend(extract_upload(file.filename or "upload", content))
    try:
        chunks = build_index(session_id, docs, provider, index)
        log_event("info", "ingest.completed", "File ingestion completed", documents=len(docs), chunks=chunks)
        return {"documents": len(docs), "chunks": chunks}
    except Exception as exc:
        log_event("error", "ingest.failed", "File ingestion failed", error_type=type(exc).__name__)
        raise HTTPException(400, f"Indexing failed. Request ID: {request.state.request_id}") from exc


@app.post("/ingest/url")
async def ingest_url(payload: IngestUrlRequest, request: Request):
    if not settings.enable_url_ingestion:
        raise HTTPException(status_code=503, detail="URL ingestion is disabled on this deployment.")
    log_event("info", "url_ingest.started", "URL ingestion started", provider=payload.provider.provider, embedding_provider=payload.provider.embedding_provider, vector_store=payload.index.vector_store)
    try:
        docs = await extract_url(payload.url)
        chunks = build_index(payload.session_id, docs, payload.provider, payload.index)
        log_event("info", "url_ingest.completed", "URL ingestion completed", documents=len(docs), chunks=chunks)
        return {"documents": len(docs), "chunks": chunks}
    except Exception as exc:
        log_event("error", "url_ingest.failed", "URL ingestion failed", error_type=type(exc).__name__)
        raise HTTPException(400, f"URL ingestion failed. Request ID: {request.state.request_id}") from exc


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, request: Request, db: Session = Depends(db_session)):
    log_event("info", "chat.started", "Chat request started", provider=payload.provider.provider, embedding_provider=payload.provider.embedding_provider, vector_store=payload.index.vector_store)
    try:
        save_message(db, payload.session_id, "user", payload.question)
        answer, citations = run_rag(payload)
        serialised = [citation.model_dump() for citation in citations]
        save_message(db, payload.session_id, "assistant", answer, serialised)
        log_event("info", "chat.completed", "Chat request completed", citations=len(citations))
        return ChatResponse(answer=answer, citations=citations)
    except Exception as exc:
        log_event("error", "chat.failed", "Chat request failed", error_type=type(exc).__name__)
        raise HTTPException(400, f"Chat failed. Request ID: {request.state.request_id}") from exc


@app.get("/conversations/{session_id}")
def conversations(session_id: str = Path(..., pattern=SESSION_ID_PATTERN), db: Session = Depends(db_session)):
    conversation = db.query(Conversation).filter_by(session_id=session_id).first()
    if not conversation:
        return []
    rows = db.query(Message).filter_by(conversation_id=conversation.id).order_by(Message.id).all()
    return [{"role": row.role, "content": row.content, "citations": json.loads(row.citations_json)} for row in rows]
