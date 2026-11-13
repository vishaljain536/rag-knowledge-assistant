# Global RAG Assistant

Ask questions about your documents and inspect the passages used in the answer. The React frontend connects to a FastAPI backend. LangGraph routes questions through retrieval and generation. SQLite keeps user accounts and each user's private sessions, source records and transcripts.

Open **Documentation** in the app to read the same project files, including the changelog and code walkthrough.

- [Code walkthrough](CODE_WALKTHROUGH.md) explains the request flows, storage and provider adapters.
- [Changelog](CHANGELOG.md) records changes, upgrade steps and verification.
- [Deployment guide](DEPLOYMENT.md) covers configuration, persistence and release checks.
- [Project review](PROJECT_GUIDE.md) records the findings that motivated these changes.

## Start locally

### Docker Compose

1. Copy `.env.example` to `.env` and set `DEMO_ADMIN_PASSWORD` to a strong secret, for example from `python -c "import secrets; print(secrets.token_urlsafe(24))"`.
2. Run `docker compose up --build` and open [the local frontend](http://localhost:5173).
3. Continue as a guest, create an account with email and password, or use Google if `GOOGLE_CLIENT_ID` is set. Enter a provider key, upload a file, and ask a question.

Compose binds the services to loopback and uses the named `rag-data` volume. `docker compose down` retains the volume. Review the [upgrade steps](DEPLOYMENT.md#upgrading-from-the-prototype) if you already have a bind-mounted data directory.

### Native development on Windows

Backend, from `backend/` in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.lock
$env:DEMO_ADMIN_PASSWORD = python -c "import secrets; print(secrets.token_urlsafe(24))"
$env:DEMO_ADMIN_PASSWORD
python -m uvicorn app.main:app --reload --port 8000 --no-access-log
```

Frontend, from `frontend/` with Node.js 24:

```powershell
npm ci
npm run dev
```

Sign in as a guest, with email and password, or with Google. Each account gets a private set of sessions, and the browser keeps you signed in for 30 days. Guest accounts are tied to the browser they were created in.

Use **Model settings** to enter provider credentials and **Sources** to add files. On a phone, both controls are in the toolbar below the workspace header.

## Admin

The admin signs in separately at `/#admin` (for example `http://localhost:5173/#admin`) with `ADMIN_USERNAME` (default `admin`) and `DEMO_ADMIN_PASSWORD`. The regular sign-in screen does not link to it. After signing in, **Users** in the sidebar lists every registered user with their sign-in method, join date, last sign-in, sign-in count and session count, plus totals for registered users, sign-ins, users active in the last 24 hours and new users this week.

## Google sign-in

Create an OAuth client of type **Web application** in Google Cloud Console, add the frontend origin (for example `https://rag-knowledge-assistant-wine.vercel.app` and `http://localhost:5173`) under **Authorized JavaScript origins**, and set its client ID as `GOOGLE_CLIENT_ID` on the API. The frontend reads it from the API, so no frontend rebuild is needed. The API verifies each Google ID token's signature, audience and verified email before signing the user in.

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

## Admin server-managed provider keys

The admin can select a configured server key or paste a personal key in **Model settings**. Configure provider keys only as server secrets (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `AZURE_OPENAI_API_KEY`), never as `VITE_*` variables. Regular users must use their own keys. See [DEPLOYMENT.md](DEPLOYMENT.md) for the billing and embedding-provider rules.
