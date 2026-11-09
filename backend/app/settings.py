import re
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{32,128}")
WORKSPACE_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{0,62}")
HOST_PATTERN = re.compile(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")


class Settings(BaseSettings):
    database_url: str = "sqlite:///./data/app.db"
    data_dir: Path = Path("data")
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    workspace_tokens: dict[str, SecretStr] = Field(default_factory=dict)
    admin_token: SecretStr | None = None
    enable_local_demo_login: bool = False
    hosted_demo_origin: str = ""
    demo_admin_password: SecretStr
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None
    groq_api_key: SecretStr | None = None
    anthropic_api_key: SecretStr | None = None
    mistral_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    azure_openai_api_key: SecretStr | None = None
    enable_url_ingestion: bool = False
    url_allowed_hosts: str = ""
    azure_allowed_endpoints: str = ""
    huggingface_allowed_models: str = ""
    pinecone_index: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    @field_validator("workspace_tokens")
    @classmethod
    def check_workspaces(cls, value):
        tokens = set()
        for workspace, token in value.items():
            raw = token.get_secret_value()
            if not WORKSPACE_PATTERN.fullmatch(workspace) or not TOKEN_PATTERN.fullmatch(raw) or raw in tokens:
                raise ValueError("Use unique URL-safe tokens of 32–128 characters and valid workspace slugs.")
            tokens.add(raw)
        return value

    @field_validator("admin_token")
    @classmethod
    def check_admin(cls, value):
        if value is not None and not value.get_secret_value():
            return None
        if value and not TOKEN_PATTERN.fullmatch(value.get_secret_value()):
            raise ValueError("Use a URL-safe admin token of 32–128 characters.")
        return value

    @field_validator("demo_admin_password")
    @classmethod
    def check_demo_admin_password(cls, value):
        if not value.get_secret_value():
            raise ValueError("DEMO_ADMIN_PASSWORD must not be empty.")
        return value

    @model_validator(mode="after")
    def check_separate_admin(self):
        if self.admin_token and self.admin_token in self.workspace_tokens.values():
            raise ValueError("The admin token must be different from every workspace token.")
        return self

    @field_validator("azure_allowed_endpoints")
    @classmethod
    def check_azure_endpoints(cls, value):
        for endpoint in value.split(","):
            endpoint = endpoint.strip()
            if not endpoint:
                continue
            parsed = urlsplit(endpoint)
            if (
                parsed.scheme != "https" or not HOST_PATTERN.fullmatch(parsed.netloc)
                or "." not in parsed.netloc or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
            ):
                raise ValueError("Azure endpoints must be HTTPS resource origins.")
        return value

    @property
    def azure_endpoints(self) -> set[str]:
        return {endpoint.strip().rstrip("/") for endpoint in self.azure_allowed_endpoints.split(",") if endpoint.strip()}

    @property
    def allowed_url_hosts(self) -> set[str]:
        return {host.strip().lower() for host in self.url_allowed_hosts.split(",") if host.strip()}
    @property
    def server_key_providers(self) -> set[str]:
        return {
            provider
            for provider in ("openai", "gemini", "groq", "anthropic", "mistral", "openrouter", "azure_openai")
            if getattr(self, f"{provider}_api_key") is not None
        }

    def server_key_for(self, provider: str) -> SecretStr | None:
        if provider not in {"openai", "gemini", "groq", "anthropic", "mistral", "openrouter", "azure_openai"}:
            return None
        return getattr(self, f"{provider}_api_key")


settings = Settings()
