import json
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from .db import SessionLocal, init_db
from .documents import extract_upload, extract_url
from .graph import run_rag
from .models import Conversation, Message
from .rag import build_index
from .schemas import ChatRequest, ChatResponse, IndexSettings, IngestUrlRequest, ProviderSettings
from .settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Global RAG Assistant API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(",")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


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


@app.post("/ingest/files")
async def ingest_files(
    session_id: str = Form(...),
    provider_json: str = Form(...),
    index_json: str = Form("{}"),
    files: list[UploadFile] = File(...),
):
    provider = ProviderSettings.model_validate_json(provider_json)
    index = IndexSettings.model_validate_json(index_json)
    docs = []
    for file in files:
        content = await file.read()
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(413, f"{file.filename} is over the 25 MB upload limit.")
        docs.extend(extract_upload(file.filename or "upload", content))
    try:
        chunks = build_index(session_id, docs, provider, index)
        return {"documents": len(docs), "chunks": chunks}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/ingest/url")
async def ingest_url(request: IngestUrlRequest):
    try:
        docs = await extract_url(request.url)
        chunks = build_index(request.session_id, docs, request.provider, request.index)
        return {"documents": len(docs), "chunks": chunks}
    except Exception as exc:
        raise HTTPException(400, f"Could not ingest URL: {exc}") from exc


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(db_session)):
    try:
        save_message(db, request.session_id, "user", request.question)
        answer, citations = run_rag(request)
        serialised = [citation.model_dump() for citation in citations]
        save_message(db, request.session_id, "assistant", answer, serialised)
        return ChatResponse(answer=answer, citations=citations)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/conversations/{session_id}")
def conversations(session_id: str, db: Session = Depends(db_session)):
    conversation = db.query(Conversation).filter_by(session_id=session_id).first()
    if not conversation:
        return []
    rows = db.query(Message).filter_by(conversation_id=conversation.id).order_by(Message.id).all()
    return [{"role": row.role, "content": row.content, "citations": json.loads(row.citations_json)} for row in rows]
