from collections.abc import Mapping
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


def response_text(content: object) -> str:
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
    return "I couldn't read a text response from the selected model. Please try again."
