import type { CorpusProfile, EmbeddingProvider, Provider, Settings } from "./types";
import { Icon } from "./Icons";

export const providers: Record<Provider, { label: string; model: string }> = {
  openai: { label: "OpenAI", model: "gpt-4o-mini" },
  gemini: { label: "Google Gemini", model: "gemini-3.1-flash-lite" },
  groq: { label: "Groq", model: "llama-3.1-8b-instant" },
  anthropic: { label: "Anthropic Claude", model: "claude-sonnet-5-5" },
  mistral: { label: "Mistral AI", model: "mistral-small-latest" },
  openrouter: { label: "OpenRouter", model: "openrouter/auto" },
  azure_openai: { label: "Azure OpenAI", model: "gpt-4o-mini" },
};

const embeddings: Record<EmbeddingProvider, { label: string; model: string }> = {
  openai: { label: "OpenAI", model: "text-embedding-3-small" },
  gemini: { label: "Google Gemini", model: "gemini-embedding-001" },
  azure_openai: { label: "Azure OpenAI", model: "" },
  huggingface: { label: "Hugging Face (local)", model: "sentence-transformers/all-MiniLM-L6-v2" },
};

function needsEmbeddingKey(settings: Settings) {
  return settings.credential_mode === "user" && settings.embedding_provider !== "huggingface" && settings.embedding_provider !== settings.provider;
}

export function modelIssue(settings: Settings): string | null {
  if (settings.credential_mode === "user" && !settings.api_key.trim()) return "Enter a provider API key or choose a configured server key.";
  if (!settings.model.trim()) return "Enter the chat model name.";
  const azureChat = settings.provider === "azure_openai";
  const azureEmbeddings = settings.embedding_provider === "azure_openai";
  if ((azureChat || azureEmbeddings) && !settings.azure_endpoint?.trim()) return "Enter the approved Azure endpoint.";
  if (azureChat && !settings.azure_deployment?.trim()) return "Enter the Azure chat deployment.";
  if (azureEmbeddings && !settings.azure_embedding_deployment?.trim()) return "Enter the Azure embedding deployment.";
  if (needsEmbeddingKey(settings) && !settings.embedding_api_key?.trim()) return "Enter a separate embedding API key.";
  if (!Number.isInteger(settings.chunk_size) || settings.chunk_size < 200 || settings.chunk_size > 4000) return "Set the chunk size between 200 and 4,000 characters.";
  if (!Number.isInteger(settings.chunk_overlap) || settings.chunk_overlap < 0 || settings.chunk_overlap > 1000 || settings.chunk_overlap >= settings.chunk_size) return "Set the overlap between 0 and 1,000 and below the chunk size.";
  return null;
}

type Props = {
  settings: Settings;
  profile: CorpusProfile | null;
  update: (patch: Partial<Settings>) => void;
  issue: string | null;
  disabled: boolean;
  canUseServerManagedKeys: boolean;
  serverKeyProviders: Provider[];
};

export function ModelSettings({ settings, profile, update, issue, disabled, canUseServerManagedKeys, serverKeyProviders }: Props) {
  const azureChat = settings.provider === "azure_openai";
  const azureEmbeddings = settings.embedding_provider === "azure_openai";
  const separateKey = needsEmbeddingKey(settings);
  const serverKeyAvailable = serverKeyProviders.includes(settings.provider);

  function selectProvider(provider: Provider) {
    const defaultEmbeddings = provider === "openai" || provider === "gemini" || provider === "azure_openai";
    const embeddingProvider = !profile && defaultEmbeddings ? provider : settings.embedding_provider;
    const credentialMode = settings.credential_mode === "server" && serverKeyProviders.includes(provider) ? "server" : "user";
    update({
      provider, model: providers[provider].model, credential_mode: credentialMode, api_key: "", embedding_provider: embeddingProvider,
      ...(embeddingProvider !== settings.embedding_provider ? { embedding_model: "", embedding_api_key: "" } : {}),
    });
  }

  function selectCredentialMode(mode: "user" | "server") {
    update({ credential_mode: mode, ...(mode === "server" ? { api_key: "", embedding_api_key: "" } : {}) });
  }

  return <fieldset disabled={disabled} className="settings-fields">
    <section>
      <h3>Chat provider</h3>
      <div className="field-grid">
        <label>Provider
          <select value={settings.provider} onChange={event => selectProvider(event.target.value as Provider)}>
            {Object.entries(providers).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
          </select>
        </label>
        {!azureChat && <label>Chat model<input value={settings.model} onChange={event => update({ model: event.target.value })} /></label>}
        {azureChat && <label>Chat deployment<input value={settings.azure_deployment || ""} onChange={event => update({ azure_deployment: event.target.value })} /></label>}
      </div>

      {canUseServerManagedKeys && <label>Credential source
        <select value={settings.credential_mode} onChange={event => selectCredentialMode(event.target.value as "user" | "server")}>
          <option value="user">Use my own API key</option>
          {serverKeyAvailable && <option value="server">Use configured server key</option>}
        </select>
      </label>}

      {settings.credential_mode === "user" ? <label>Provider API key
        <input type="password" autoComplete="off" placeholder="Paste your provider key" value={settings.api_key} onChange={event => update({ api_key: event.target.value })} />
      </label> : <p className="field-note positive"><Icon name="check" size={14} />This demo admin session uses the server-managed {providers[settings.provider].label} key. The key is never sent to your browser.</p>}

      {(azureChat || azureEmbeddings) && <label>Azure endpoint
        <input disabled={Boolean(profile?.azure_endpoint)} value={settings.azure_endpoint || ""} onChange={event => update({ azure_endpoint: event.target.value, ...(settings.credential_mode === "user" ? { api_key: "", embedding_api_key: "" } : {}) })} placeholder="https://resource.openai.azure.com" />
      </label>}
      {azureEmbeddings && <label>Embedding deployment
        <input disabled={Boolean(profile)} value={settings.azure_embedding_deployment || ""} onChange={event => update({ azure_embedding_deployment: event.target.value })} />
      </label>}
      {separateKey && <label>Embedding API key
        <input type="password" autoComplete="off" placeholder="Required when providers differ" value={settings.embedding_api_key || ""} onChange={event => update({ embedding_api_key: event.target.value })} />
      </label>}
    </section>

    <details className="advanced-settings">
      <summary>Embeddings and retrieval <Icon name="chevron" size={15} /></summary>
      {profile && <p className="field-note"><Icon name="lock" size={14} />Index settings are saved for this session. Open a new session to change them.</p>}
      <div className="field-grid">
        <label>Embedding provider
          <select disabled={Boolean(profile)} value={settings.embedding_provider} onChange={event => update({ embedding_provider: event.target.value as EmbeddingProvider, embedding_model: "", embedding_api_key: "" })}>
            {Object.entries(embeddings).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
          </select>
        </label>
        {!azureEmbeddings && <label>Embedding model
          <input disabled={Boolean(profile) || settings.embedding_provider === "gemini"} value={settings.embedding_model || profile?.embedding_model || ""} placeholder={embeddings[settings.embedding_provider].model} onChange={event => update({ embedding_model: event.target.value })} />
        </label>}
      </div>
      {!separateKey && settings.credential_mode === "user" && settings.embedding_provider !== "huggingface" && <label>Separate embedding API key <small>Optional</small>
        <input type="password" autoComplete="off" placeholder="Uses the chat provider key by default" value={settings.embedding_api_key || ""} onChange={event => update({ embedding_api_key: event.target.value })} />
      </label>}
      <label>Vector store
        <select disabled={Boolean(profile)} value={settings.vector_store} onChange={event => update({ vector_store: event.target.value as Settings["vector_store"] })}>
          <option value="faiss">FAISS (local)</option><option value="chroma">Chroma (local)</option><option value="pinecone">Pinecone (server configured)</option>
        </select>
      </label>
      <div className="field-grid">
        <label>Chunk size <small>characters</small><input disabled={Boolean(profile)} type="number" min={200} max={4000} value={settings.chunk_size || ""} onChange={event => update({ chunk_size: Number(event.target.value) })} /></label>
        <label>Chunk overlap <small>characters</small><input disabled={Boolean(profile)} type="number" min={0} max={Math.min(1000, settings.chunk_size - 1)} value={settings.chunk_overlap} onChange={event => update({ chunk_overlap: Number(event.target.value) })} /></label>
      </div>
    </details>
    <p className={`field-note ${issue ? "" : "positive"}`} role="status"><Icon name={issue ? "info" : "check"} size={15} />{issue || "Model settings are ready to use."}</p>
  </fieldset>;
}
