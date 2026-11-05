from typing import Literal
from pydantic import BaseModel, Field

Provider = Literal["openai", "gemini", "groq", "azure_openai"]
Store = Literal["faiss", "chroma", "pinecone"]


class ProviderSettings(BaseModel):
    provider: Provider = "openai"
    model: str = "gpt-4o-mini"
    api_key: str = Field(min_length=1)
    azure_endpoint: str | None = None
    azure_deployment: str | None = None
    api_version: str = "2024-10-21"
    embedding_provider: Literal["openai", "gemini", "huggingface"] = "openai"
    embedding_api_key: str | None = None
    embedding_model: str | None = None


class IndexSettings(BaseModel):
    vector_store: Store = "faiss"
    pinecone_index: str | None = None
    pinecone_namespace: str = "default"
    chunk_size: int = Field(default=900, ge=200, le=4000)
    chunk_overlap: int = Field(default=150, ge=0, le=1000)


class IngestUrlRequest(BaseModel):
    url: str
    session_id: str
    provider: ProviderSettings
    index: IndexSettings = Field(default_factory=IndexSettings)


class ChatRequest(BaseModel):
    session_id: str
    question: str = Field(min_length=1, max_length=12000)
    provider: ProviderSettings
    index: IndexSettings = Field(default_factory=IndexSettings)


class Citation(BaseModel):
    source: str
    page: int | None = None
    chunk: int
    excerpt: str


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]
