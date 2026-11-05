import { ChangeEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { addUrl, ask, upload } from "./api";
import type { ChatMessage, Settings } from "./types";

const defaults: Settings = {provider:"openai", model:"gpt-4o-mini", api_key:"", embedding_provider:"openai", embedding_api_key:"", embedding_model:"sentence-transformers/all-MiniLM-L6-v2", vector_store:"faiss", pinecone_index:"", pinecone_namespace:"default", chunk_size:900, chunk_overlap:150};
const sessionId = crypto.randomUUID();
const suggestions = ["What are the main points?", "Summarize the uploaded information", "What evidence supports the conclusion?"];

export default function App() {
  const [settings, setSettings] = useState(defaults); const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<File[]>([]); const [url, setUrl] = useState(""); const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState("Add sources, then ask a question."); const fileInput = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Settings>) => setSettings(old => ({...old, ...patch}));
  const providerNeedsAzure = settings.provider === "azure_openai";
  const canChat = useMemo(() => !!settings.api_key && !busy, [settings.api_key, busy]);

  async function ingestFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []); if (!incoming.length) return;
    if (!settings.api_key) { setStatus("Enter your provider API key before adding sources."); return; }
    setFiles(old => [...old, ...incoming]); setBusy(true);
    try { const result = await upload(sessionId, incoming, settings); setStatus(`Indexed ${result.chunks} passages from ${result.documents} file(s).`); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Upload failed"); } finally { setBusy(false); }
  }
  async function ingestUrl() {
    if (!url.trim()) return;
    if (!settings.api_key) { setStatus("Enter your provider API key before adding sources."); return; }
    setBusy(true); try { const result = await addUrl(sessionId, url, settings); setStatus(`Indexed ${result.chunks} passages from this webpage.`); setUrl(""); } catch (error) { setStatus(error instanceof Error ? error.message : "URL import failed"); } finally { setBusy(false); }
  }
  async function send() { const question = input.trim(); if (!question || !canChat) return; setInput(""); setMessages(old => [...old, {role:"user", content:question}]); setBusy(true); try { const result = await ask(sessionId, question, settings); setMessages(old => [...old, {role:"assistant", content:result.answer, citations:result.citations}]); } catch (error) { setMessages(old => [...old, {role:"assistant", content:`**Error:** ${error instanceof Error ? error.message : "Request failed"}`}]); } finally { setBusy(false); } }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span>✦</span><div><strong>Global RAG</strong><small>Multi-source assistant</small></div></div>
      <section><h2>Model</h2><label>Provider<select value={settings.provider} onChange={e => update({provider:e.target.value as Settings["provider"]})}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="groq">Groq</option><option value="azure_openai">Azure OpenAI</option></select></label>
      <label>Model<input value={settings.model} onChange={e => update({model:e.target.value})} placeholder="gpt-4o-mini" /></label><label>API key<input type="password" value={settings.api_key} onChange={e => update({api_key:e.target.value})} placeholder="Stored only in this browser tab" /></label>
      {providerNeedsAzure && <><label>Azure endpoint<input value={settings.azure_endpoint || ""} onChange={e => update({azure_endpoint:e.target.value})} placeholder="https://resource.openai.azure.com" /></label><label>Deployment<input value={settings.azure_deployment || ""} onChange={e => update({azure_deployment:e.target.value})} /></label></>}
      <label>Embedding provider<select value={settings.embedding_provider} onChange={e => update({embedding_provider:e.target.value as Settings["embedding_provider"]})}><option value="openai">OpenAI embeddings</option><option value="gemini">Gemini embeddings</option><option value="huggingface">Hugging Face local embeddings</option></select></label>
      {settings.embedding_provider === "huggingface" ? <label>Hugging Face model<input value={settings.embedding_model || ""} onChange={e => update({embedding_model:e.target.value})} placeholder="sentence-transformers/all-MiniLM-L6-v2" /></label> : <label>Embedding API key (optional)<input type="password" value={settings.embedding_api_key || ""} onChange={e => update({embedding_api_key:e.target.value})} placeholder="Needed when chat and embedding keys differ" /></label>}
      </section>
      <section><h2>Retrieval</h2><label>Vector store<select value={settings.vector_store} onChange={e => update({vector_store:e.target.value as Settings["vector_store"]})}><option value="faiss">FAISS (local)</option><option value="chroma">Chroma (local)</option><option value="pinecone">Pinecone</option></select></label>
      {settings.vector_store === "pinecone" && <label>Index name<input value={settings.pinecone_index} onChange={e => update({pinecone_index:e.target.value})} /></label>}<label>Chunk size<input type="number" value={settings.chunk_size} onChange={e => update({chunk_size:Number(e.target.value)})}/></label></section>
      <p className="privacy">Keys are passed only to your configured backend. Do not use a shared deployment with secrets you do not control.</p></aside>
    <section className="chat"><header><div><p className="eyebrow">KNOWLEDGE WORKSPACE</p><h1>Ask your sources</h1><p className="subtitle">PDF · DOCX · Excel · CSV · text · web pages · images</p></div><span className={busy ? "status busy" : "status"}>{busy ? "Working" : "Ready"}</span></header>
      <div className="source-bar"><button className="upload" onClick={() => fileInput.current?.click()} disabled={busy || !settings.api_key}>＋ Add files</button><input ref={fileInput} type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" multiple hidden onChange={ingestFiles}/><div className="url-input"><input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a public webpage URL"/><button onClick={ingestUrl} disabled={busy || !url.trim() || !settings.api_key}>Add URL</button></div></div>
      {files.length > 0 && <div className="chips">{files.map((file, i) => <span key={`${file.name}-${i}`}>▣ {file.name}</span>)}</div>}<p className="status-line">{status}</p>
      <div className="messages">{messages.length === 0 ? <div className="empty"><div className="empty-icon">⌁</div><h2>Build an answer from your own data</h2><p>Upload documents or add a web page, then ask a specific question.</p><div className="suggestions">{suggestions.map(s => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div></div> : messages.map((message, i) => <article className={`message ${message.role}`} key={i}><div className="avatar">{message.role === "user" ? "You" : "AI"}</div><div className="bubble"><ReactMarkdown>{message.content}</ReactMarkdown>{message.citations && <details><summary>Sources ({message.citations.length})</summary>{message.citations.map((c, j) => <div className="citation" key={j}><strong>[{j + 1}] {c.source}{c.page ? ` · page ${c.page}` : ""}</strong><p>{c.excerpt}</p></div>)}</details>}</div></article>)}</div>
      <footer><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} placeholder={settings.api_key ? "Ask a question about your sources…" : "Enter an API key to start…"} rows={2}/><button className="send" onClick={send} disabled={!input.trim() || !canChat}>Send ↗</button><small>Enter to send · Shift+Enter for a new line</small></footer>
    </section>
  </main>;
}
