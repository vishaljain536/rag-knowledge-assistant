import type { ChatMessage, Settings } from "./types";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiFailure = { detail?: unknown; request_id?: unknown };
type IngestResult = { documents: number; chunks: number };
type ChatResult = { answer: string; citations: NonNullable<ChatMessage["citations"]> };

const provider = (settings: Settings) => ({
  provider: settings.provider,
  model: settings.model,
  api_key: settings.api_key,
  azure_endpoint: settings.azure_endpoint || null,
  azure_deployment: settings.azure_deployment || null,
  embedding_provider: settings.embedding_provider,
  embedding_api_key: settings.embedding_api_key || null,
  embedding_model: settings.embedding_model || null,
});

const index = (settings: Settings) => ({
  vector_store: settings.vector_store,
  pinecone_index: settings.pinecone_index || null,
  pinecone_namespace: settings.pinecone_namespace,
  chunk_size: settings.chunk_size,
  chunk_overlap: settings.chunk_overlap,
});

function errorDetail(body: unknown, status: number, requestId?: string): string {
  const failure = body as ApiFailure | null;
  const detail = typeof failure?.detail === "string" ? failure.detail : null;
  const identifier = typeof failure?.request_id === "string" ? failure.request_id : requestId;
  const suffix = identifier ? ` Request ID: ${identifier}.` : "";
  return detail ? `${detail}${suffix}` : `The API returned HTTP ${status}.${suffix}`;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError("Unable to reach the API. Check the API URL, your connection, and CORS settings.");
    }
    throw new ApiError("The request could not be completed.");
  }

  const requestId = response.headers.get("X-Request-ID") || undefined;
  let body: unknown = null;
  try {
    const contentType = response.headers.get("content-type") || "";
    body = contentType.includes("application/json") ? await response.json() : await response.text();
  } catch {
    throw new ApiError(`The API returned an unreadable response (HTTP ${response.status}).`, response.status, requestId);
  }

  if (!response.ok) {
    throw new ApiError(errorDetail(body, response.status, requestId), response.status, requestId);
  }
  return body as T;
}

export async function upload(sessionId: string, files: File[], settings: Settings): Promise<IngestResult> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("provider_json", JSON.stringify(provider(settings)));
  form.append("index_json", JSON.stringify(index(settings)));
  files.forEach(file => form.append("files", file));
  return request<IngestResult>("/ingest/files", { method: "POST", body: form });
}

export async function addUrl(sessionId: string, url: string, settings: Settings): Promise<IngestResult> {
  return request<IngestResult>("/ingest/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, url, provider: provider(settings), index: index(settings) }),
  });
}

export async function ask(sessionId: string, question: string, settings: Settings): Promise<ChatResult> {
  return request<ChatResult>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, question, provider: provider(settings), index: index(settings) }),
  });
}
