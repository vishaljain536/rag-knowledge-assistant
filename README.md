# Global RAG Assistant

Ask questions about your documents and inspect the passages used in the answer. The React frontend connects to a FastAPI backend. LangGraph routes questions through retrieval and generation. SQLite keeps workspace-scoped sessions, source records and transcripts.

Open **Documentation** in the app to read the same project files, including the changelog and code walkthrough.

- [Code walkthrough](CODE_WALKTHROUGH.md) explains the request flows, storage and provider adapters.
- [Changelog](CHANGELOG.md) records changes, upgrade steps and verification.
- [Deployment guide](DEPLOYMENT.md) covers configuration, persistence and release checks.
- [Project review](PROJECT_GUIDE.md) records the findings that motivated these changes.

## Start locally

### Docker Compose

1. Copy `.env.example` to `.env` and generate a token with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Set `WORKSPACE_TOKENS='{"local":"paste-your-generated-token-here"}'` in `.env`. Treat the token like a password.
3. Run `docker compose up --build` and open [the local frontend](http://localhost:5173).
4. Connect with the workspace token. Enter a provider key, upload a file, and ask a question. Use one workspace slug and independently generated token per group that should share a corpus.

Compose binds the services to loopback and uses the named `rag-data` volume. `docker compose down` retains the volume. Review the [upgrade steps](DEPLOYMENT.md#upgrading-from-the-prototype) if you already have a bind-mounted data directory.

### Native development on Windows

Backend, from `backend/` in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.lock
$workspaceToken = python -c "import secrets; print(secrets.token_urlsafe(32))"
$env:WORKSPACE_TOKENS = @{ local = $workspaceToken } | ConvertTo-Json -Compress
$workspaceToken
python -m uvicorn app.main:app --reload --port 8000 --no-access-log
```

Frontend, from `frontend/` with Node.js 24:

```powershell
npm ci
npm run dev
```

Use the workspace token printed in the backend terminal. To reuse the same workspace on a later launch, supply its configured slug and token again. The session list, uploaded source labels and transcripts are restored after reconnecting. Only the last selected session ID is stored in the browser.

Use **Model settings** to enter provider credentials and **Sources** to add files. On a phone, both controls are in the toolbar below the workspace header.

To use the demo account, set `$env:ENABLE_LOCAL_DEMO_LOGIN = 'true'` before starting the API on loopback. Open the frontend on localhost at port 5173 and select **Use admin login**. Select **Use a workspace token instead** to return to token sign-in.

## Sources and providers

- Supported uploads are text PDFs, DOCX, XLSX, UTF-8 CSV, TXT and Markdown. XLSX uses cached cell values. DOCX extracts paragraphs and top-level table rows. OCR is needed before uploading image-only PDFs or standalone images.
- FAISS is the default store. Chroma is a local option. Pinecone requires a server-managed key and compatible index, with one server-derived namespace per session.
- Chat adapters cover OpenAI, Gemini, Groq, Anthropic, Mistral, OpenRouter and Azure OpenAI. Enter a separate embedding key if chat and embeddings use different hosted providers.
- The default OpenAI embedding model is `text-embedding-3-small`. Gemini uses `gemini-embedding-001` with separate retrieval task modes for queries and documents. Azure requires an approved resource origin and distinct chat and embedding deployment fields. [Google Gemini embedding documentation](https://ai.google.dev/gemini-api/docs/embeddings?authuser=117) · [Microsoft Azure embedding setup](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/embeddings)
- Optional local Hugging Face embeddings require installing `requirements-local.txt` in a fresh native environment and setting `HUGGINGFACE_ALLOWED_MODELS` to the approved model ID. The default local model ID in the UI is `sentence-transformers/all-MiniLM-L6-v2`.
- The first ingestion binds the index to its embedding settings. Start a new session and re-upload sources when changing the embedding model, store, or chunking.
- URL import requires an explicit backend allowlist and opt-in. See [deployment configuration](DEPLOYMENT.md#optional-features).

## Verify locally

```text
cd backend
python -m pip install -r requirements-test.txt
python -m pytest -q
```

The tests use temporary SQLite and local indexes with synthetic provider responses. To build the frontend, run `npm ci` and `npm run build` from `frontend/`. See the [release checks](DEPLOYMENT.md#release-checks) for a live provider smoke test.
