export type Provider = "openai" | "gemini" | "groq" | "azure_openai";
export type VectorStore = "faiss" | "chroma" | "pinecone";
export type Citation = { source: string; page?: number; chunk: number; excerpt: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; citations?: Citation[] };

export type Settings = {
  deployment_access_key: string;
  provider: Provider; model: string; api_key: string; azure_endpoint?: string; azure_deployment?: string;
  embedding_provider: "openai" | "gemini" | "huggingface"; embedding_api_key?: string; embedding_model?: string;
  vector_store: VectorStore; pinecone_index?: string; pinecone_namespace: string; chunk_size: number; chunk_overlap: number;
};
