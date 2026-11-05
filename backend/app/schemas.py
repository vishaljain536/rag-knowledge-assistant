from typing import Annotated, Literal
from pydantic import BaseModel, Field, model_validator

Provider = Literal["openai", "gemini", "groq", "anthropic", "mistral", "openrouter", "azure_openai"]
Store = Literal["faiss", "chroma", "pinecone"]
SESSION_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
SessionId = Annotated[str, Field(pattern=SESSION_ID_PATTERN)]


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

    @model_validator(mode="after")
    def validate_embedding_credentials(self):
        if self.embedding_provider == "openai" and self.provider not in {"openai", "azure_openai"} and not self.embedding_api_key:
            raise ValueError("A separate OpenAI embedding API key is required for this chat provider.")
        if self.embedding_provider == "gemini" and self.provider != "gemini" and not self.embedding_api_key:
            raise ValueError("A separate Gemini embedding API key is required for this chat provider.")
        return self


class IndexSettings(BaseModel):
    vector_store: Store = "faiss"
    pinecone_index: str | None = None
    pinecone_namespace: str = "default"
    chunk_size: int = Field(default=900, ge=200, le=4000)
    chunk_overlap: int = Field(default=150, ge=0, le=1000)


class IngestUrlRequest(BaseModel):
    url: str
    session_id: SessionId
    provider: ProviderSettings
    index: IndexSettings = Field(default_factory=IndexSettings)


class ChatRequest(BaseModel):
    session_id: SessionId
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
