import { ChangeEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { addUrl, ask, upload } from "./api";
import type { ChatMessage, Settings } from "./types";

const providerModels: Record<Settings["provider"], string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-3.1-flash-lite",
  groq: "llama-3.1-8b-instant",
  anthropic: "claude-sonnet-5-5",
  mistral: "mistral-small-latest",
  openrouter: "openrouter/auto",
  azure_openai: "gpt-4o-mini",
};

const defaults: Settings = {
  provider: "openai",
  model: providerModels.openai,
  api_key: "",
  embedding_provider: "openai",
  embedding_api_key: "",
  embedding_model: "sentence-transformers/all-MiniLM-L6-v2",
  vector_store: "faiss",
  pinecone_index: "",
  pinecone_namespace: "default",
  chunk_size: 900,
  chunk_overlap: 150,
};

const urlIngestionEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_URL_INGESTION === "true";
const suggestions = ["What are the main points?", "Summarize the uploaded information", "What evidence supports the conclusion?"];
const sessionId = crypto.randomUUID();

type StatusTone = "neutral" | "success" | "error";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function App() {
  const [settings, setSettings] = useState(defaults);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Add sources, then ask a question.");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const fileInput = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<Settings>) => setSettings(current => ({ ...current, ...patch }));
  const providerNeedsAzure = settings.provider === "azure_openai";
  const embeddingKeyRequired =
    (settings.embedding_provider === "openai" && !["openai", "azure_openai"].includes(settings.provider)) ||
    (settings.embedding_provider === "gemini" && settings.provider !== "gemini");
  const canChat = useMemo(
    () => !!settings.api_key && (!embeddingKeyRequired || !!settings.embedding_api_key) && !busy,
    [settings.api_key, settings.embedding_api_key, embeddingKeyRequired, busy],
  );

  async function ingestFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files || []);
    if (!incoming.length) return;
    if (!settings.api_key) {
      setStatus("Enter your provider API key before adding sources.");
      setStatusTone("error");
      return;
    }

    setBusy(true);
    setStatus("Reading and indexing your files…");
    setStatusTone("neutral");
    try {
      const result = await upload(sessionId, incoming, settings);
      setFiles(current => [...current, ...incoming]);
      setStatus(`Indexed ${result.chunks} passages from ${result.documents} file(s).`);
      setStatusTone("success");
    } catch (error) {
      setStatus(messageFrom(error, "Upload failed. Please try again."));
      setStatusTone("error");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function ingestUrl() {
    if (!url.trim()) return;
    if (!settings.api_key) {
      setStatus("Enter your provider API key before adding sources.");
      setStatusTone("error");
      return;
    }

    setBusy(true);
    setStatus("Reading and indexing the webpage…");
    setStatusTone("neutral");
    try {
      const result = await addUrl(sessionId, url, settings);
      setStatus(`Indexed ${result.chunks} passages from this webpage.`);
      setStatusTone("success");
      setUrl("");
    } catch (error) {
      setStatus(messageFrom(error, "URL import failed. Please try again."));
      setStatusTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const question = input.trim();
    if (!question || !canChat) return;

    setInput("");
    setMessages(current => [...current, { role: "user", content: question }]);
    setBusy(true);
    try {
      const result = await ask(sessionId, question, settings);
      setMessages(current => [...current, { role: "assistant", content: result.answer, citations: result.citations }]);
    } catch (error) {
      setMessages(current => [...current, {
        role: "assistant",
        content: `**Request failed**\n\n${messageFrom(error, "Please try again.")}`,
      }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <span aria-hidden="true">✦</span>
        <div><strong>Global RAG</strong><small>Multi-source assistant</small></div>
      </div>

      <section>
        <h2>Model</h2>
        <label>Provider
          <select value={settings.provider} onChange={event => {
            const provider = event.target.value as Settings["provider"];
            update({ provider, model: providerModels[provider] });
          }}>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="groq">Groq</option>
            <option value="anthropic">Anthropic Claude</option>
            <option value="mistral">Mistral AI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="azure_openai">Azure OpenAI</option>
          </select>
        </label>
        <label>Model<input value={settings.model} onChange={event => update({ model: event.target.value })} placeholder="gpt-4o-mini" /></label>
        <label>API key<input type="password" value={settings.api_key} onChange={event => update({ api_key: event.target.value })} placeholder="Stored only in this browser tab" /></label>
        {providerNeedsAzure && <>
          <label>Azure endpoint<input value={settings.azure_endpoint || ""} onChange={event => update({ azure_endpoint: event.target.value })} placeholder="https://resource.openai.azure.com" /></label>
          <label>Deployment<input value={settings.azure_deployment || ""} onChange={event => update({ azure_deployment: event.target.value })} /></label>
        </>}
        <label>Embedding provider
          <select value={settings.embedding_provider} onChange={event => update({ embedding_provider: event.target.value as Settings["embedding_provider"] })}>
            <option value="openai">OpenAI embeddings</option>
            <option value="gemini">Gemini embeddings</option>
            <option value="huggingface">Hugging Face local embeddings</option>
          </select>
        </label>
        {settings.embedding_provider === "huggingface"
          ? <label>Hugging Face model<input value={settings.embedding_model || ""} onChange={event => update({ embedding_model: event.target.value })} placeholder="sentence-transformers/all-MiniLM-L6-v2" /></label>
          : <label>Embedding API key {embeddingKeyRequired ? "(required)" : "(optional)"}<input type="password" value={settings.embedding_api_key || ""} onChange={event => update({ embedding_api_key: event.target.value })} placeholder={embeddingKeyRequired ? "Required because the chat key cannot create these embeddings" : "Needed when chat and embedding keys differ"} /></label>}
      </section>

      <section>
        <h2>Retrieval</h2>
        <label>Vector store
          <select value={settings.vector_store} onChange={event => update({ vector_store: event.target.value as Settings["vector_store"] })}>
            <option value="faiss">FAISS (local)</option>
            <option value="chroma">Chroma (local)</option>
            <option value="pinecone">Pinecone</option>
          </select>
        </label>
        {settings.vector_store === "pinecone" && <label>Index name<input value={settings.pinecone_index} onChange={event => update({ pinecone_index: event.target.value })} /></label>}
        <label>Chunk size<input type="number" value={settings.chunk_size} onChange={event => update({ chunk_size: Number(event.target.value) })} /></label>
      </section>

      <p className="privacy">Keys are kept only in this browser tab and sent to the backend you choose.</p>
    </aside>

    <section className="chat">
      <header>
        <div>
          <p className="eyebrow">KNOWLEDGE WORKSPACE</p>
          <h1>Ask your sources</h1>
          <p className="subtitle">Grounded answers from your documents, web pages, and notes.</p>
        </div>
        <span className={busy ? "status busy" : "status"}><i aria-hidden="true" />{busy ? "Working" : "Ready"}</span>
      </header>

      <div className="source-bar">
        <button className="upload" onClick={() => fileInput.current?.click()} disabled={busy || !settings.api_key}>＋ Add files</button>
        <input ref={fileInput} type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" multiple hidden onChange={ingestFiles} />
        {urlIngestionEnabled && <div className="url-input"><input value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a public webpage URL" /><button onClick={() => void ingestUrl()} disabled={busy || !url.trim() || !settings.api_key}>Add URL</button></div>}
      </div>

      {files.length > 0 && <div className="chips">{files.map((file, index) => <span key={`${file.name}-${index}`}>▣ {file.name}</span>)}</div>}
      <p className={`status-line ${statusTone}`}>{status}</p>

      <div className="messages" aria-live="polite">
        {messages.length === 0
          ? <div className="empty">
              <div className="empty-icon" aria-hidden="true">⌁</div>
              <h2>Build an answer from your own data</h2>
              <p>Add documents, then ask a focused question. Every answer includes its supporting sources.</p>
              <div className="suggestions">{suggestions.map(suggestion => <button key={suggestion} onClick={() => setInput(suggestion)}>{suggestion}</button>)}</div>
            </div>
          : messages.map((message, index) => <article className={`message ${message.role}`} key={index}>
              <div className="avatar">{message.role === "user" ? "You" : "AI"}</div>
              <div className="bubble">
                <ReactMarkdown>{message.content}</ReactMarkdown>
                {message.citations && <details><summary>Sources ({message.citations.length})</summary>{message.citations.map((citation, citationIndex) => <div className="citation" key={citationIndex}><strong>[{citationIndex + 1}] {citation.source}{citation.page ? ` · page ${citation.page}` : ""}</strong><p>{citation.excerpt}</p></div>)}</details>}
              </div>
            </article>)}
      </div>

      <footer>
        <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={onKeyDown} placeholder={settings.api_key ? "Ask a question about your sources…" : "Enter an API key to start…"} rows={2} />
        <button className="send" onClick={() => void send()} disabled={!input.trim() || !canChat}>Send <span aria-hidden="true">↗</span></button>
        <div className="footer-meta"><small>Enter to send · Shift+Enter for a new line</small><small className="copyright">© 2026 Vishal Jain</small></div>
      </footer>
    </section>
  </main>;
}
