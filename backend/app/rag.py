import json
import os
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from langchain_community.docstore.in_memory import InMemoryDocstore
from langchain_chroma import Chroma
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from .documents import ExtractedSource
from .errors import ApiError
from .schemas import CorpusProfile, IndexSettings
from .settings import settings


MAX_CHUNKS_PER_UPLOAD = 1500
MAX_CHUNKS_PER_CORPUS = 10_000
MAX_SOURCES_PER_CORPUS = 256


class CheckedEmbeddings(Embeddings):
    def __init__(self, inner: Embeddings, dimension: int | None):
        self.inner = inner
        self.dimension = dimension

    def _check(self, vector: list[float]) -> None:
        if self.dimension is None:
            self.dimension = len(vector)
        if not vector or len(vector) != self.dimension:
            raise ApiError(409, "embedding_dimension", "Embedding dimensions changed. Create a new corpus.")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors = self.inner.embed_documents(texts)
        if len(vectors) != len(texts):
            raise ApiError(502, "invalid_embeddings", "The embedding provider returned an incomplete batch.")
        for vector in vectors:
            self._check(vector)
        return vectors

    def embed_query(self, text: str) -> list[float]:
        vector = self.inner.embed_query(text)
        self._check(vector)
        return vector


def split(source: ExtractedSource, index: IndexSettings) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=index.chunk_size, chunk_overlap=index.chunk_overlap)
    chunks = splitter.split_documents(source.documents)
    for number, chunk in enumerate(chunks, 1):
        chunk.id = f"{source.id}-{number}"
        chunk.metadata.update(source=source.label, source_id=source.id, chunk=number)
    return chunks


def store_path(session_id: str) -> Path:
    root = (settings.data_dir / "corpora").resolve()
    path = root / session_id
    if path.parent != root or path.resolve() != path:
        raise ApiError(409, "index_unavailable", "The corpus storage path is unavailable.")
    return path


def _snapshot_path(session_id: str, snapshot: str) -> Path:
    directory = store_path(session_id)
    path = directory / f"{snapshot}.index"
    if path.parent != directory or path.resolve() != path:
        raise ApiError(409, "index_unavailable", "The corpus storage path is unavailable.")
    return path


def load_faiss(session_id: str, snapshot: str, digest: str, embedder: CheckedEmbeddings) -> FAISS:
    import faiss
    import numpy as np

    try:
        with _snapshot_path(session_id, snapshot).open("rb") as file:
            size = int.from_bytes(file.read(8), "big")
            # Verify the entire application-created artifact before invoking the FAISS decoder.
            file.seek(0)
            payload = file.read()
        if sha256(payload).hexdigest() != digest or not 0 < size < len(payload) - 8:
            raise ValueError("Index snapshot verification failed")
        rows = json.loads(payload[8:8 + size])
        index = faiss.deserialize_index(np.frombuffer(payload, dtype=np.uint8, offset=8 + size))
        if len(rows) != index.ntotal or index.d != embedder.dimension:
            raise ValueError("Index snapshot metadata does not match the vector index")
        documents = {row["id"]: Document.model_validate(row) for row in rows}
        return FAISS(embedder, index, InMemoryDocstore(documents), dict(enumerate(documents)))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        raise ApiError(409, "index_unavailable", "The corpus index is unavailable. Restore a matching backup or rebuild it.") from exc


def save_faiss(session_id: str, vector: FAISS) -> tuple[str, str]:
    import faiss

    rows = [
        vector.docstore.search(vector.index_to_docstore_id[i]).model_dump(mode="json")
        for i in range(vector.index.ntotal)
    ]
    metadata = json.dumps(rows, separators=(",", ":")).encode()
    native = faiss.serialize_index(vector.index)
    length = len(metadata).to_bytes(8, "big")
    digest = sha256(length)
    digest.update(metadata)
    digest.update(native)
    snapshot = str(uuid4())
    path = _snapshot_path(session_id, snapshot)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # The database points to the snapshot only after this new file is complete.
        with path.open("xb") as file:
            file.write(length)
            file.write(metadata)
            file.write(native)
            file.flush()
            os.fsync(file.fileno())
        if os.name == "posix":
            descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    except OSError:
        path.unlink(missing_ok=True)
        raise
    return snapshot, digest.hexdigest()


def remove_snapshot(session_id: str, snapshot: str) -> None:
    _snapshot_path(session_id, snapshot).unlink(missing_ok=True)


def shared_store(session_id: str, profile: CorpusProfile, embedder: CheckedEmbeddings):
    if profile.index.vector_store == "chroma":
        return Chroma(
            persist_directory=str(store_path(session_id) / "chroma"),
            collection_name="documents", embedding_function=embedder,
        )
    from langchain_pinecone import PineconeVectorStore
    return PineconeVectorStore(
        index_name=profile.pinecone_index, embedding=embedder, namespace=f"corpus-{session_id}",
    )


def append(
    session_id: str, profile: CorpusProfile, embedder: CheckedEmbeddings,
    chunks: list[Document], snapshot: str | None, digest: str | None,
) -> tuple[str | None, str | None]:
    ids = [chunk.id for chunk in chunks]
    if profile.index.vector_store != "faiss":
        # Stable IDs let a retry overwrite any partial upserts before the source becomes visible.
        shared_store(session_id, profile, embedder).add_documents(chunks, ids=ids)
        return None, None
    if snapshot and digest:
        vector = load_faiss(session_id, snapshot, digest, embedder)
        vector.add_documents(chunks, ids=ids)
    else:
        vector = FAISS.from_documents(chunks, embedder, ids=ids)
    return save_faiss(session_id, vector)


def retrieve(
    session_id: str, question: str, profile: CorpusProfile, embedder: CheckedEmbeddings,
    snapshot: str | None, digest: str | None, source_ids: list[str],
) -> list[Document]:
    if profile.index.vector_store == "faiss":
        if not snapshot or not digest:
            raise ApiError(409, "index_unavailable", "The corpus index is unavailable.")
        return load_faiss(session_id, snapshot, digest, embedder).similarity_search(question, k=5)
    return shared_store(session_id, profile, embedder).similarity_search(
        question, k=5, filter={"source_id": {"$in": source_ids}},
    )
