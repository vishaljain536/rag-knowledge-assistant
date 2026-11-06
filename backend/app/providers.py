from collections.abc import Mapping
from langchain_core.language_models.chat_models import BaseChatModel
from .errors import ApiError
from .schemas import CorpusProfile, EMBEDDING_DEFAULTS, IndexSettings, ProviderSettings
from .settings import settings


SDK_TIMEOUT_SECONDS = 45
SDK_RETRIES = 1


def chat_model(config: ProviderSettings) -> BaseChatModel:
    key = config.api_key.get_secret_value()
    limits = {"timeout": SDK_TIMEOUT_SECONDS, "max_retries": SDK_RETRIES}
    if config.provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=config.model, api_key=key, temperature=0.2, **limits)
    if config.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=config.model, google_api_key=key, temperature=0.2, **limits)
    if config.provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(model=config.model, api_key=key, temperature=0.2, **limits)
    if config.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=config.model, api_key=key, temperature=0.2, **limits)
    if config.provider == "mistral":
        from langchain_mistralai import ChatMistralAI
        return ChatMistralAI(model=config.model, api_key=key, temperature=0.2, **limits)
    if config.provider == "openrouter":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=config.model, api_key=key, base_url="https://openrouter.ai/api/v1", temperature=0.2, **limits)
    if config.provider == "azure_openai":
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI(
            azure_deployment=config.azure_deployment, azure_endpoint=config.azure_endpoint, api_key=key,
            api_version=config.api_version, temperature=0.2, **limits,
        )
    raise ValueError(f"Unsupported chat provider: {config.provider}")


def corpus_profile(provider: ProviderSettings, index: IndexSettings) -> CorpusProfile:
    kind = provider.embedding_provider
    azure = kind == "azure_openai"
    pinecone = settings.pinecone_index.strip() if index.vector_store == "pinecone" else None
    if index.vector_store == "pinecone" and not pinecone:
        raise ApiError(422, "store_unavailable", "Pinecone has not been configured on the server.")
    model = provider.azure_embedding_deployment if azure else provider.embedding_model or EMBEDDING_DEFAULTS[kind]
    if kind == "gemini":
        model = model.removeprefix("models/")
    return CorpusProfile(
        index=index,
        embedding_provider=kind,
        embedding_model=model,
        azure_endpoint=provider.azure_endpoint if azure else None,
        api_version=provider.api_version if azure else None,
        pinecone_index=pinecone,
    )


def embeddings(provider: ProviderSettings, profile: CorpusProfile):
    kind = profile.embedding_provider
    key = (provider.embedding_api_key or provider.api_key).get_secret_value()
    if kind == "huggingface":
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(
            model_name=profile.embedding_model,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    if kind == "gemini":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        return GoogleGenerativeAIEmbeddings(
            model=profile.embedding_model, google_api_key=key, client_args={"timeout": SDK_TIMEOUT_SECONDS},
        )
    if kind == "azure_openai":
        from langchain_openai import AzureOpenAIEmbeddings
        return AzureOpenAIEmbeddings(
            api_key=key, azure_endpoint=profile.azure_endpoint,
            azure_deployment=profile.embedding_model, model=profile.embedding_model, api_version=profile.api_version,
            timeout=SDK_TIMEOUT_SECONDS, max_retries=SDK_RETRIES,
        )
    from langchain_openai import OpenAIEmbeddings
    return OpenAIEmbeddings(
        api_key=key, model=profile.embedding_model, timeout=SDK_TIMEOUT_SECONDS, max_retries=SDK_RETRIES,
    )


def response_text(content: object, *, fallback: str = "I couldn't read a text response from the selected model. Please try again.") -> str:
    """Return displayable text from either plain or structured model content."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, Mapping) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        text = "\n".join(part for part in parts if part.strip()).strip()
        if text:
            return text
    return fallback
