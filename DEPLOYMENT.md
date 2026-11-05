# Deployment

The supported hosted topology is:

- React/Vite frontend on Vercel.
- FastAPI backend on one free Render Docker instance.
- SQLite and local FAISS/Chroma data on the ephemeral `/tmp/rag-data` path.

The API has no login. Anyone with the backend URL can call it, but every request needs the caller's own model-provider key, so usage is billed to whoever sends the request.

## Safety defaults

- Hosted URL ingestion is disabled because the current URL fetcher is not yet hardened against SSRF. File ingestion remains available.
- Session identifiers must be canonical UUIDs before they can reach database or vector-index paths.
- The backend accepts only the configured Vercel origin through CORS.
- Use one backend instance while using SQLite and local vector indexes.

## 1. Deploy the backend on Render

1. In Render, create a Blueprint from this GitHub repository.
2. Render reads `render.yaml` and proposes one free Docker web service.
3. `CORS_ORIGINS` is preconfigured for `https://rag-knowledge-assistant-wine.vercel.app`. Change it if you assign a custom frontend domain.
4. Apply the Blueprint. No payment is required for the free plan.
5. Wait for `GET /health` to return `{"status":"ok"}`.

The service uses Python 3.12 and starts Uvicorn on Render's injected `PORT`.

### Free-plan limitations

The free instance has an ephemeral filesystem and sleeps after 15 minutes of inactivity. Uploaded files, the SQLite conversation history, and local FAISS/Chroma indexes under `/tmp/rag-data` are lost on every restart, redeploy, or spin-down, and the first request after sleep takes about a minute. Re-upload sources after any restart. Use **Gemini chat + Gemini embeddings** on the free plan; local Hugging Face embeddings need more memory than the free instance provides. For durable storage, upgrade to a paid plan with a persistent disk (set `plan: starter` and re-add the `disk:` block with `DATA_DIR=/app/data`).

## 2. Deploy the frontend on Vercel

1. Import the same GitHub repository into Vercel.
2. Keep the repository root as the project root; `vercel.json` runs the build in `frontend/` and publishes `frontend/dist`.
3. Add production environment variable:

   ```text
   VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
   ```

4. Leave `VITE_ENABLE_URL_INGESTION` unset. Hosted URL ingestion must remain hidden until the SSRF-safe fetcher is implemented.
5. Deploy. If the backend CORS value was a placeholder, replace `CORS_ORIGINS` on Render with this exact Vercel URL and redeploy the backend.

## 3. Use the application

1. Open the Vercel URL.
2. Enter an LLM provider key. Keys stay in React memory for the current tab and are sent to the configured backend per request.
3. Upload files and ask questions.

## Operational limits

- Do not scale beyond one backend instance with SQLite/local indexes.
- Local Hugging Face embeddings consume more memory and have a slower first request. API embeddings use less backend memory.
- Do not expose URL ingestion by setting `ENABLE_URL_INGESTION=true` until redirect-aware SSRF validation and response-size limits are implemented.
- There is no authentication. Session IDs are random UUIDs, but anyone who learns one can read that session's chat history through `/conversations/{session_id}`.
