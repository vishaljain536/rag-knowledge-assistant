import type { Settings } from "./types";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const provider = (s: Settings) => ({provider:s.provider, model:s.model, api_key:s.api_key, azure_endpoint:s.azure_endpoint || null, azure_deployment:s.azure_deployment || null, embedding_provider:s.embedding_provider, embedding_api_key:s.embedding_api_key || null, embedding_model:s.embedding_model || null});
const index = (s: Settings) => ({vector_store:s.vector_store, pinecone_index:s.pinecone_index || null, pinecone_namespace:s.pinecone_namespace, chunk_size:s.chunk_size, chunk_overlap:s.chunk_overlap});
const authHeaders = (s: Settings): Record<string, string> => s.deployment_access_key ? {"X-App-Access-Key": s.deployment_access_key} : {};

async function request(path: string, init: RequestInit) {
  const response = await fetch(`${API}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || "Request failed");
  return body;
}

export async function upload(sessionId: string, files: File[], s: Settings) {
  const form = new FormData(); form.append("session_id", sessionId); form.append("provider_json", JSON.stringify(provider(s))); form.append("index_json", JSON.stringify(index(s))); files.forEach(file => form.append("files", file));
  return request("/ingest/files", {method:"POST", headers:authHeaders(s), body:form});
}

export async function addUrl(sessionId: string, url: string, s: Settings) {
  return request("/ingest/url", {method:"POST", headers:{"Content-Type":"application/json", ...authHeaders(s)}, body:JSON.stringify({session_id:sessionId, url, provider:provider(s), index:index(s)})});
}

export async function ask(sessionId: string, question: string, s: Settings) {
  return request("/chat", {method:"POST", headers:{"Content-Type":"application/json", ...authHeaders(s)}, body:JSON.stringify({session_id:sessionId, question, provider:provider(s), index:index(s)})});
}
