from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from .settings import settings

Provider = Literal["openai", "gemini", "groq", "anthropic", "mistral", "openrouter", "azure_openai"]
EmbeddingProvider = Literal["openai", "gemini", "huggingface", "azure_openai"]
Store = Literal["faiss", "chroma", "pinecone"]
SESSION_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
SessionId = Annotated[str, Field(pattern=SESSION_ID_PATTERN)]
DeploymentName = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")]
ModelName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12000)]

EMBEDDING_DEFAULTS = {
    "openai": "text-embedding-3-small",
    "gemini": "gemini-embedding-001",
    "huggingface": "sentence-transformers/all-MiniLM-L6-v2",
}
CONFIG_ERRORS = {
    "api_key_required": "Enter a provider API key or choose an available server key.",
    "embedding_key_required": "A separate embedding key is required when the providers differ.",
    "azure_endpoint_required": "Choose an Azure endpoint approved by the server.",
    "azure_chat_deployment": "Enter the Azure chat deployment.",
    "azure_embedding_deployment": "Enter the Azure embedding deployment.",
    "huggingface_model": "Choose a Hugging Face model approved by the server with local embeddings installed.",
    "gemini_model_retired": "The selected Gemini embedding model has been retired.",
    "gemini_model_unsupported": "This text retrieval adapter supports gemini-embedding-001.",
    "chunk_overlap": "Chunk overlap must be smaller than chunk size.",
}


def _config_error(code: str) -> PydanticCustomError:
    return PydanticCustomError(code, CONFIG_ERRORS[code])


class ProviderSettings(BaseModel):
    provider: Provider = "openai"
    model: ModelName = "gpt-4o-mini"
    credential_mode: Literal["user", "server"] = "user"
    api_key: SecretStr | None = Field(default=None, min_length=1, max_length=4096)
    azure_endpoint: str | None = Field(default=None, max_length=255)
    azure_deployment: DeploymentName | None = None
    azure_embedding_deployment: DeploymentName | None = None
    api_version: str = Field(default="2024-10-21", pattern=r"^\d{4}-\d{2}-\d{2}(-preview)?$")
    embedding_provider: EmbeddingProvider = "openai"
    embedding_api_key: SecretStr | None = Field(default=None, min_length=1, max_length=4096)
    embedding_model: ModelName | None = None

    @model_validator(mode="after")
    def validate_provider_configuration(self):
        if self.credential_mode == "user" and not self.api_key:
            raise _config_error("api_key_required")
        if self.credential_mode == "user" and self.embedding_provider != "huggingface" and self.embedding_provider != self.provider and not self.embedding_api_key:
            raise _config_error("embedding_key_required")
        if self.provider == "azure_openai" or self.embedding_provider == "azure_openai":
            self.azure_endpoint = (self.azure_endpoint or "").rstrip("/")
            if self.azure_endpoint not in settings.azure_endpoints:
                raise _config_error("azure_endpoint_required")
        if self.provider == "azure_openai" and not self.azure_deployment:
            raise _config_error("azure_chat_deployment")
        if self.embedding_provider == "azure_openai" and not self.azure_embedding_deployment:
            raise _config_error("azure_embedding_deployment")
        if self.embedding_provider == "huggingface":
            allowed = {model.strip() for model in settings.huggingface_allowed_models.split(",")}
            if (self.embedding_model or EMBEDDING_DEFAULTS["huggingface"]) not in allowed:
                raise _config_error("huggingface_model")
        if self.embedding_provider == "gemini" and self.embedding_model in {"text-embedding-004", "models/text-embedding-004"}:
            raise _config_error("gemini_model_retired")
        if self.embedding_provider == "gemini" and self.embedding_model and self.embedding_model.removeprefix("models/") != EMBEDDING_DEFAULTS["gemini"]:
            raise _config_error("gemini_model_unsupported")
        return self


class IndexSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vector_store: Store = "faiss"
    chunk_size: int = Field(default=900, ge=200, le=4000)
    chunk_overlap: int = Field(default=150, ge=0, le=1000)

    @model_validator(mode="after")
    def validate_overlap(self):
        if self.chunk_overlap >= self.chunk_size:
            raise _config_error("chunk_overlap")
        return self


class CorpusProfile(BaseModel):
    index: IndexSettings
    embedding_provider: EmbeddingProvider
    embedding_model: str
    azure_endpoint: str | None = None
    api_version: str | None = None
    pinecone_index: str | None = None


class IngestUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    session_id: SessionId
    provider: ProviderSettings
    index: IndexSettings | None = None


class IngestForm(BaseModel):
    session_id: SessionId
    provider_json: str
    index_json: str | None = None


class ChatRequest(BaseModel):
    session_id: SessionId
    question: Question
    provider: ProviderSettings
    index: IndexSettings | None = None


class Citation(BaseModel):
    number: int
    source_id: str
    source: str
    page: int | None = None
    sheet: str | None = None
    chunk: int
    excerpt: str


class ChatResponse(BaseModel):
    answer: str
    citations: list[Citation]
