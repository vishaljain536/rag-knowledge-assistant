export type CredentialMode = "user" | "server";
export type Identity = { workspace: string; authentication: "workspace_token" | "demo_admin"; can_use_server_managed_keys: boolean; server_key_providers: Provider[] };
export type Provider = "openai" | "gemini" | "groq" | "anthropic" | "mistral" | "openrouter" | "azure_openai";
export type OperationalLog = { sequence: number; timestamp: string; level: string; event: string; message: string; request_id?: string; details: Record<string, unknown> };
export type VectorStore = "faiss" | "chroma" | "pinecone";
export type EmbeddingProvider = "openai" | "gemini" | "huggingface" | "azure_openai";
export type Citation = { number: number; source_id: string; source: string; page?: number; sheet?: string; chunk: number; excerpt: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; citations?: Citation[] };

export type CorpusProfile = {
  index: { vector_store: VectorStore; chunk_size: number; chunk_overlap: number };
  embedding_provider: EmbeddingProvider;
  embedding_model: string;
  azure_endpoint?: string | null;
  api_version?: string | null;
};

export type Source = { id: string; label: string; chunks: number };
export type SessionSummary = { session_id: string; created_at: string };
export type SessionState = { session_id: string; profile: CorpusProfile | null; sources: Source[] };

export type Settings = {
  credential_mode: CredentialMode;
  provider: Provider; model: string; api_key: string; azure_endpoint?: string; azure_deployment?: string;
  azure_embedding_deployment?: string; api_version?: string;
  embedding_provider: EmbeddingProvider; embedding_api_key?: string; embedding_model?: string;
  vector_store: VectorStore; chunk_size: number; chunk_overlap: number;
};
