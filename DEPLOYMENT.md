# Deployment

The supported hosted topology is:

- React/Vite frontend on Vercel.
- FastAPI backend on one Render Docker instance with a persistent disk.
- SQLite and local FAISS/Chroma data on `/app/data`.

This is a private, single-tenant deployment. It is protected by `APP_ACCESS_KEY`, which users enter in the UI for each browser tab. It is not a multi-user authentication system.

## Safety defaults

- Hosted URL ingestion is disabled because the current URL fetcher is not yet hardened against SSRF. File ingestion remains available.
- Session identifiers must be canonical UUIDs before they can reach database or vector-index paths.
- The backend accepts only the configured Vercel origin through CORS.
- Use one backend instance while using SQLite and local vector indexes.

## 1. Deploy the backend on Render

1. In Render, create a Blueprint from this GitHub repository.
2. Render reads `render.yaml` and proposes one Docker web service with a 10 GB persistent disk.
3. Set `CORS_ORIGINS` to the exact HTTPS URL of the Vercel production deployment. Update it after Vercel assigns the final URL if necessary.
4. Keep the generated `APP_ACCESS_KEY` secret. Copy its value for use in the UI's **Deployment access key** field.
5. Confirm the paid service and disk price shown by Render before applying the Blueprint.
6. Wait for `GET /health` to return `{"status":"ok"}`.

The service uses Python 3.12 and starts Uvicorn on Render's injected `PORT`. The disk stores SQLite, local indexes, and the Hugging Face model cache.

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
2. Enter the Render `APP_ACCESS_KEY` in **Deployment access key**.
3. Enter an LLM provider key. Keys stay in React memory for the current tab and are sent to the configured backend per request.
4. Upload files and ask questions.

## Operational limits

- Do not scale beyond one backend instance with SQLite/local indexes.
- Back up the Render disk and test restoration.
- Local Hugging Face embeddings consume more memory and have a slower first request. API embeddings use less backend memory.
- Do not expose URL ingestion by setting `ENABLE_URL_INGESTION=true` until redirect-aware SSRF validation and response-size limits are implemented.
- This access-key boundary is suitable for a private single-tenant deployment, not public multi-user access.
