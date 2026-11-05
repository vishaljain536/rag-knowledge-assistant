from pathlib import Path
from typing import Any
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS, Chroma
from langchain_core.documents import Document
from .schemas import ProviderSettings, IndexSettings
from .settings import settings


def embeddings(provider: ProviderSettings):
    embedding_key = provider.embedding_api_key or provider.api_key
    if provider.embedding_provider == "huggingface":
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(
            model_name=provider.embedding_model or "sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    if provider.embedding_provider == "gemini":
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        return GoogleGenerativeAIEmbeddings(model="models/text-embedding-004", google_api_key=embedding_key)
    if provider.embedding_provider == "openai":
        from langchain_openai import OpenAIEmbeddings, AzureOpenAIEmbeddings
        if provider.provider == "azure_openai":
            return AzureOpenAIEmbeddings(api_key=provider.api_key, azure_endpoint=provider.azure_endpoint, azure_deployment=provider.azure_deployment, api_version=provider.api_version)
        return OpenAIEmbeddings(api_key=embedding_key)
    raise ValueError(f"Unsupported embedding provider: {provider.embedding_provider}")


def split(documents: list[Document], index: IndexSettings) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=index.chunk_size, chunk_overlap=index.chunk_overlap)
    chunks = splitter.split_documents(documents)
    for number, chunk in enumerate(chunks, 1):
        chunk.metadata["chunk"] = number
    return chunks


def store_path(session_id: str) -> Path:
    index_root = (settings.data_dir / "indexes").resolve()
    path = (index_root / session_id).resolve()
    if not path.is_relative_to(index_root):
        raise ValueError("Invalid session identifier.")
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_index(session_id: str, documents: list[Document], provider: ProviderSettings, index: IndexSettings) -> int:
    chunks = split(documents, index)
    if not chunks:
        return 0
    embedder = embeddings(provider)
    path = store_path(session_id)
    if index.vector_store == "chroma":
        Chroma.from_documents(chunks, embedder, persist_directory=str(path / "chroma"), collection_name="documents")
    elif index.vector_store == "pinecone":
        if not index.pinecone_index:
            raise ValueError("A Pinecone index name is required when Pinecone is selected.")
        from langchain_pinecone import PineconeVectorStore
        PineconeVectorStore.from_documents(chunks, embedder, index_name=index.pinecone_index, namespace=index.pinecone_namespace)
    else:
        vector = FAISS.from_documents(chunks, embedder)
        vector.save_local(str(path / "faiss"))
    return len(chunks)


def retrieve(session_id: str, question: str, provider: ProviderSettings, index: IndexSettings) -> list[Document]:
    embedder = embeddings(provider)
    path = store_path(session_id)
    if index.vector_store == "chroma":
        vector: Any = Chroma(persist_directory=str(path / "chroma"), collection_name="documents", embedding_function=embedder)
    elif index.vector_store == "pinecone":
        from langchain_pinecone import PineconeVectorStore
        vector = PineconeVectorStore(index_name=index.pinecone_index, embedding=embedder, namespace=index.pinecone_namespace)
    else:
        vector = FAISS.load_local(str(path / "faiss"), embedder, allow_dangerous_deserialization=True)
    return vector.similarity_search(question, k=5)
