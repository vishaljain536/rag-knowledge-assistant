import json
from collections.abc import Callable
from threading import Lock
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import rag
from .db import SessionLocal
from .documents import ExtractedSource
from .errors import ApiError
from .graph import is_casual_greeting, run_rag
from .models import Message, RagSession, Source
from .operational_logs import log_event
from .providers import corpus_profile, embeddings
from .schemas import ChatRequest, ChatResponse, CorpusProfile, IndexSettings, ProviderSettings


# One supported API worker. Bound the lock table even when many sessions are created.
_locks = tuple(Lock() for _ in range(64))


def _lock(session_id: str):
    return _locks[hash(session_id) % len(_locks)]


def _owned(db: Session, workspace: str, session_id: str) -> RagSession:
    session = db.scalar(select(RagSession).where(RagSession.id == session_id, RagSession.workspace == workspace))
    if session is None:
        raise ApiError(404, "session_not_found", "This session was not found in your workspace.")
    return session


def _sources(db: Session, session_id: str) -> list[Source]:
    return list(db.scalars(select(Source).where(Source.session_id == session_id).order_by(Source.created_at, Source.id)))


def _source_view(source: Source) -> dict:
    return {"id": source.id, "label": source.label, "chunks": source.chunks}


def create_session(workspace: str) -> dict:
    with SessionLocal.begin() as db:
        session_id = str(uuid4())
        db.add(RagSession(id=session_id, workspace=workspace))
    return {"session_id": session_id}


def list_sessions(workspace: str) -> list[dict]:
    with SessionLocal() as db:
        sessions = db.scalars(
            select(RagSession).where(RagSession.workspace == workspace).order_by(RagSession.created_at.desc(), RagSession.id)
            .limit(50)
        )
        return [{"session_id": session.id, "created_at": session.created_at.isoformat() + "Z"} for session in sessions]


def _profile_view(profile: CorpusProfile) -> dict:
    return profile.model_dump(exclude={"pinecone_index"})


def session_state(workspace: str, session_id: str) -> dict:
    with _lock(session_id), SessionLocal() as db:
        session = _owned(db, workspace, session_id)
        profile = CorpusProfile.model_validate_json(session.profile_json) if session.profile_json else None
        sources = [_source_view(source) for source in _sources(db, session_id)]
        return {
            "session_id": session_id,
            "profile": _profile_view(profile) if profile else None,
            "sources": sources,
        }


def conversation(workspace: str, session_id: str) -> list[dict]:
    with SessionLocal() as db:
        _owned(db, workspace, session_id)
        rows = db.scalars(
            select(Message).where(Message.session_id == session_id).order_by(Message.id.desc()).limit(100)
        ).all()
        return [
            {"role": row.role, "content": row.content, "citations": json.loads(row.citations_json)}
            for row in reversed(rows)
        ]


def _profile(session: RagSession, provider: ProviderSettings, index: IndexSettings | None) -> CorpusProfile:
    stored = CorpusProfile.model_validate_json(session.profile_json) if session.profile_json else None
    requested = corpus_profile(provider, index or (stored.index if stored else IndexSettings()))
    if stored and requested != stored:
        raise ApiError(409, "corpus_settings_mismatch", "Use the saved corpus settings or start a new session to re-index.")
    return stored or requested


def ingest(
    workspace: str, session_id: str, provider: ProviderSettings, index: IndexSettings | None,
    extract: Callable[[], list[ExtractedSource]],
) -> dict:
    with _lock(session_id), SessionLocal() as db:
        session = _owned(db, workspace, session_id)
        profile = _profile(session, provider, index)
        existing = _sources(db, session_id)
        prior_snapshot, prior_digest, dimension = session.snapshot, session.snapshot_digest, session.dimension
        had_profile = session.profile_json is not None
        existing_ids = {source.id for source in existing}
        total_chunks = sum(source.chunks for source in existing)
        sources = [_source_view(source) for source in existing]
        db.commit()

        chunks = []
        new_sources = []
        for source in extract():
            if source.id in existing_ids:
                continue
            existing_ids.add(source.id)
            items = rag.split(source, profile.index)
            if not items:
                raise ApiError(422, "empty_source", "No searchable passages were extracted.")
            new_sources.append(Source(session_id=session_id, id=source.id, label=source.label, chunks=len(items)))
            chunks.extend(items)
            if (
                len(chunks) > rag.MAX_CHUNKS_PER_UPLOAD or total_chunks + len(chunks) > rag.MAX_CHUNKS_PER_CORPUS
                or len(existing_ids) > rag.MAX_SOURCES_PER_CORPUS
            ):
                raise ApiError(413, "corpus_limit", "This upload would exceed the corpus source or passage limit.")
        if not chunks:
            return {"documents": 0, "chunks": 0, "sources": sources, "profile": _profile_view(profile)}

        if not had_profile and profile.index.vector_store != "faiss":
            # A remote store may accept part of a write. Reserve its profile before the first upsert.
            session.profile_json = profile.model_dump_json()
            db.commit()
        try:
            embedder = rag.CheckedEmbeddings(embeddings(provider, profile), dimension)
            snapshot, digest = rag.append(session_id, profile, embedder, chunks, prior_snapshot, prior_digest)
        except ApiError:
            raise
        except Exception as exc:
            log_event("error", "index.failed", "Index update failed", error_type=type(exc).__name__)
            raise ApiError(502, "index_failed", "The index could not be updated. Check the embedding and store settings.") from exc

        session.profile_json = profile.model_dump_json()
        session.dimension = embedder.dimension
        session.snapshot = snapshot
        session.snapshot_digest = digest
        db.add_all(new_sources)
        sources.extend(_source_view(source) for source in new_sources)
        db.commit()
        if prior_snapshot and prior_snapshot != snapshot:
            try:
                rag.remove_snapshot(session_id, prior_snapshot)
            except (OSError, ApiError) as exc:
                log_event("warning", "index.cleanup_failed", "Old index snapshot could not be removed", error_type=type(exc).__name__)
        return {"documents": len(new_sources), "chunks": len(chunks), "sources": sources, "profile": _profile_view(profile)}


def chat(workspace: str, payload: ChatRequest) -> ChatResponse:
    session_id = payload.session_id
    with _lock(session_id), SessionLocal() as db:
        session = _owned(db, workspace, session_id)
        fetch = lambda _question: []
        history = []
        try:
            if not is_casual_greeting(payload.question):
                source_ids = list(db.scalars(select(Source.id).where(Source.session_id == session_id)))
                if not source_ids:
                    raise ApiError(409, "empty_corpus", "Add a searchable source before asking a document question.")
                profile = _profile(session, payload.provider, payload.index)
                snapshot, digest, dimension = session.snapshot, session.snapshot_digest, session.dimension
                history = list(db.scalars(
                    select(Message.content).where(Message.session_id == session_id, Message.role == "user")
                    .order_by(Message.id.desc()).limit(4)
                ))
                history = [question[:600] for question in reversed(history) if not is_casual_greeting(question)]

                def fetch(question: str):
                    embedder = rag.CheckedEmbeddings(embeddings(payload.provider, profile), dimension)
                    return rag.retrieve(session_id, question, profile, embedder, snapshot, digest, source_ids)

            db.commit()
            answer, citations = run_rag(payload, fetch, history)
        except ApiError:
            raise
        except Exception as exc:
            log_event("error", "chat.failed", "Chat request failed", error_type=type(exc).__name__)
            raise ApiError(502, "chat_failed", "The model or retrieval provider could not complete the question.") from exc

        db.add(Message(session_id=session_id, role="user", content=payload.question))
        db.add(Message(
            session_id=session_id, role="assistant", content=answer,
            citations_json=json.dumps([citation.model_dump() for citation in citations]),
        ))
        db.commit()
        return ChatResponse(answer=answer, citations=citations)
