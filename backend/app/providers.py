from langchain_core.language_models.chat_models import BaseChatModel
from .schemas import ProviderSettings


def chat_model(config: ProviderSettings) -> BaseChatModel:
    if config.provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=config.model, api_key=config.api_key, temperature=0.2)
    if config.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=config.model, google_api_key=config.api_key, temperature=0.2)
    if config.provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(model=config.model, api_key=config.api_key, temperature=0.2)
    from langchain_openai import AzureChatOpenAI
    return AzureChatOpenAI(azure_deployment=config.azure_deployment or config.model, azure_endpoint=config.azure_endpoint, api_key=config.api_key, api_version=config.api_version, temperature=0.2)
