import type { ChatMessage, CorpusProfile, SessionState, SessionSummary, Settings, Source } from "./types";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiFailure = { detail?: unknown; request_id?: unknown };
type IngestResult = { documents: number; chunks: number; sources: Source[]; profile: CorpusProfile };
type ChatResult = { answer: string; citations: NonNullable<ChatMessage["citations"]> };

const provider = (settings: Settings) => ({
  provider: settings.provider,
  model: settings.model,
  api_key: settings.api_key,
  azure_endpoint: settings.azure_endpoint || null,
  azure_deployment: settings.azure_deployment || null,
  azure_embedding_deployment: settings.azure_embedding_deployment || null,
  api_version: settings.api_version || "2024-10-21",
  embedding_provider: settings.embedding_provider,
  embedding_api_key: settings.embedding_api_key || null,
  embedding_model: settings.embedding_model || null,
});

const index = (settings: Settings) => ({
  vector_store: settings.vector_store,
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

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    response = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
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
    if (contentType.includes("application/json")) body = await response.json();
  } catch {
    throw new ApiError(`The API returned an unreadable response (HTTP ${response.status}).`, response.status, requestId);
  }

  if (!response.ok) {
    throw new ApiError(errorDetail(body, response.status, requestId), response.status, requestId);
  }
  if (body === null) {
    throw new ApiError("The API returned an unexpected response. Check the configured API URL.", response.status, requestId);
  }
  return body as T;
}

export async function previewLogin(username: string, password: string) {
  const { token } = await request<{ token: string }>("", "/preview/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return token;
}

export function listSessions(token: string) {
  return request<SessionSummary[]>(token, "/sessions");
}

export function createSession(token: string) {
  return request<{ session_id: string }>(token, "/sessions", { method: "POST", body: "" });
}

export async function loadSession(token: string, id: string) {
  const [session, messages] = await Promise.all([
    request<SessionState>(token, `/sessions/${encodeURIComponent(id)}`),
    request<ChatMessage[]>(token, `/conversations/${encodeURIComponent(id)}`),
  ]);
  return { ...session, messages };
}

export async function upload(token: string, sessionId: string, files: File[], settings: Settings): Promise<IngestResult> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("provider_json", JSON.stringify(provider(settings)));
  form.append("index_json", JSON.stringify(index(settings)));
  files.forEach(file => form.append("files", file));
  return request<IngestResult>(token, "/ingest/files", { method: "POST", body: form });
}

export async function addUrl(token: string, sessionId: string, url: string, settings: Settings): Promise<IngestResult> {
  return request<IngestResult>(token, "/ingest/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, url, provider: provider(settings), index: index(settings) }),
  });
}

export async function ask(token: string, sessionId: string, question: string, settings: Settings): Promise<ChatResult> {
  return request<ChatResult>(token, "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, question, provider: provider(settings), index: index(settings) }),
  });
}
