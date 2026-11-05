# Global RAG Assistant

A full-stack, multi-provider chat application that answers questions from PDFs, Word documents, spreadsheets, text files, public URLs, and image uploads.

The React interface lets each user choose a language-model provider and retrieval store. The FastAPI backend uses LangChain for integrations and LangGraph to run a retrieve-then-answer workflow. Conversation history is stored in SQLite; document indexes can use local FAISS, local Chroma, or Pinecone.

## What is included

- **Chat UI:** React + Vite interface with document/URL ingestion, streamed-style conversation display, citations, and provider settings.
- **File support:** PDF, DOCX, XLSX/XLS, CSV, TXT, Markdown, PNG, JPG/JPEG, and WebP.
- **URL support:** extracts readable text from a public webpage.
- **LLM choices:** OpenAI, Google Gemini, Groq, Anthropic Claude, Mistral AI, OpenRouter, and Azure OpenAI.
- **Vector stores:** FAISS, Chroma, and Pinecone.
- **Database:** SQLite keeps conversation and message records for a lightweight single-user deployment.
- **Safety:** API keys are never written to SQLite or project files. Retrieved content is treated as untrusted reference material, never as application instructions.

## Architecture

```text
React browser UI
   | files / URL / question / temporary provider configuration
FastAPI
   |-- document parsers -> chunking -> embeddings -> FAISS | Chroma | Pinecone
   |-- LangGraph: retrieve -> grounded answer -> citations
   `-- SQLite: conversation metadata + messages
```

## Start locally

### Docker

1. Copy `.env.example` to `.env` and add any server-side configuration you need.
2. Run `docker compose up --build`.
3. Open `http://localhost:5173`.

### Development

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend, in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The default API URL is `http://localhost:8000`; set `VITE_API_URL` when hosting the API elsewhere.

## Provider setup

Enter the selected provider key in the UI. It is sent with the request to the backend and is not stored in SQLite.

| Chat provider | Typical model | Embeddings |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | OpenAI embeddings |
| Gemini | `gemini-1.5-flash` | Gemini embeddings or a separate OpenAI embedding key |
| Groq | `llama-3.1-8b-instant` | Groq has no embedding endpoint; choose OpenAI, Gemini, or local Hugging Face embeddings |
| Anthropic Claude | `claude-sonnet-5-5` | Choose OpenAI, Gemini, or local Hugging Face embeddings; API embeddings require a separate key |
| Mistral AI | `mistral-small-latest` | Choose OpenAI, Gemini, or local Hugging Face embeddings; API embeddings require a separate key |
| OpenRouter | `openrouter/auto` or a provider-qualified model ID | Choose OpenAI, Gemini, or local Hugging Face embeddings; API embeddings require a separate key |
| Azure OpenAI | deployment name | Azure embeddings for Azure deployments |

For a Gemini chat model, set the UI's embedding provider to Gemini if the same key should create embeddings. The Hugging Face option downloads the selected open-source Sentence Transformers model on first use and caches it locally; its default is `sentence-transformers/all-MiniLM-L6-v2` and it requires no embedding API key. Pinecone also needs its server environment credentials and an existing index compatible with the selected embedding dimensions.

## Images

The UI accepts image files and retains them as source items. This first production scaffold marks image sources for citation; connect a multimodal vision extractor for the selected provider before relying on image content as factual RAG context. PDFs with scanned images likewise need OCR or a vision extraction step.

## Deployment

For a private single-tenant hosted deployment, use the Vercel frontend and Render Docker backend configuration in [`DEPLOYMENT.md`](DEPLOYMENT.md). The frontend is available at [rag-knowledge-assistant-wine.vercel.app](https://rag-knowledge-assistant-wine.vercel.app); it becomes functional after the backend is provisioned and `VITE_API_URL` is configured. Hosted URL ingestion is disabled until its SSRF-safe fetcher is implemented. The production backend requires a deployment access key in addition to the user's model-provider key.

## Operational logs

The backend keeps the latest 500 sanitized operational events in process memory. Events include request IDs, routes, response status, durations, RAG routing, retrieval, model invocation, and ingestion counts. They exclude keys, headers, prompts, answers, document content, file names, and raw URLs. The buffer resets whenever the backend restarts.

```bash
# Recent events
curl -H "X-App-Access-Key: $APP_ACCESS_KEY" "http://localhost:8000/logs?limit=100"

# Follow events line by line as Server-Sent Events
curl -N -H "X-App-Access-Key: $APP_ACCESS_KEY" "http://localhost:8000/logs/stream"
```

Both log endpoints require the same deployment access key as the application when `APP_ACCESS_KEY` is configured. Anyone with that shared key can read these operational events; this is a private single-tenant feature, not operator-level authorization.

## Deployment notes

- Do not expose the API publicly without setting `APP_ACCESS_KEY`; this is a private single-tenant boundary, not multi-user authentication.
- Replace anonymous `session_id` use with real authentication for multi-user production.
- Use a managed database rather than SQLite when running multiple API replicas.
- The local FAISS/Chroma indexes are stored in `data/` and should be backed up or mounted as persistent storage.
