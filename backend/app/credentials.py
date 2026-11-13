from .access import AuthContext
from .errors import ApiError
from .schemas import ProviderSettings
from .settings import settings


def resolve_provider_settings(auth: AuthContext, provider: ProviderSettings) -> ProviderSettings:
    """Resolve admin-only server credentials after bearer authentication."""
    if provider.credential_mode == "user":
        return provider
    if not auth.can_use_server_managed_keys:
        raise ApiError(403, "server_credentials_forbidden", "Server-managed provider keys are available only to the admin.")

    chat_key = settings.server_key_for(provider.provider)
    if not chat_key:
        raise ApiError(422, "server_key_unavailable", f"No server key has been configured for {provider.provider}.")

    updates = {"api_key": chat_key, "embedding_api_key": None}
    if provider.embedding_provider != "huggingface":
        embedding_key = settings.server_key_for(provider.embedding_provider)
        if not embedding_key:
            raise ApiError(422, "server_embedding_key_unavailable", f"No server key has been configured for {provider.embedding_provider} embeddings.")
        updates["embedding_api_key"] = embedding_key
    return provider.model_copy(update=updates)
