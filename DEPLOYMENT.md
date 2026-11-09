# Deployment

Use one FastAPI process for a private pilot. The frontend can be served from Vercel or from the Docker image built by Compose. Workspace tokens control access to corpus data. Members sharing a workspace token share that workspace's sessions and transcripts.

## Configure workspace access

Set `WORKSPACE_TOKENS` as a JSON object mapping stable workspace slugs to separate, randomly generated tokens. Generate each token with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Enter the raw JSON in a hosting environment panel or wrap it in single quotes in a local `.env` file. An empty mapping leaves the API unavailable to workspace users.

Set a different `ADMIN_TOKEN` to enable operator access to `/logs` and `/logs/stream`. Provider keys are supplied per request and used for the selected provider. Keep workspace tokens, operator tokens and provider keys out of repository files and frontend build variables. Rotate a token by changing its value and retaining the same workspace slug. Removing a slug disables access to that workspace.

Use HTTPS between the browser and API on hosted deployments, restrict `CORS_ORIGINS` to the frontend origins, and apply connection and request-rate limits at the ingress. `GET /health` is public liveness. `GET /ready` checks database connectivity and the data directory with a workspace token.

## Deploy on Render and Vercel

1. Create the backend using [render.yaml](render.yaml). Supply the required `WORKSPACE_TOKENS` secret and set `CORS_ORIGINS` to the exact deployed Vercel origin. Wait for the Render health check to pass.
2. Set the Vercel project's root to the repository root. [vercel.json](vercel.json) installs the frontend lockfile and publishes its production build. Use Node.js 24 and set `VITE_API_URL` to the HTTPS backend origin.
3. Redeploy the frontend after changing any Vite build variable. Connect with the workspace token and verify file ingestion and chat with synthetic content.

Set `DEMO_ADMIN_PASSWORD` to a strong secret for the optional admin-demo login. Generate it with `python -c "import secrets; print(secrets.token_urlsafe(24))"`. The local preview uses it only when `ENABLE_LOCAL_DEMO_LOGIN=true`. To enable **Use admin login** for a hosted demo, set `HOSTED_DEMO_ORIGIN` to the exact HTTPS frontend origin, add it to `CORS_ORIGINS`, and set `VITE_ENABLE_HOSTED_DEMO_LOGIN=true` on Vercel before redeploying. The username is `admin`. The account opens a shared demo workspace for sample content and has no operator access.

The frontend also bundles selected Markdown files from the repository root for the in-app documentation. For a standalone frontend Docker build, run `docker build -f frontend/Dockerfile .` from the repository root. Docker Compose already uses that context.

The checked-in Render config stores SQLite and local FAISS/Chroma data in `/tmp/rag-data`, with an ephemeral filesystem. Use that configuration for disposable demos. Choose a persistent volume for a pilot with data that must survive restarts. Set both `DATA_DIR` and `DATABASE_URL` to the same volume. If using a bind mount, grant UID 10001 write access to the mounted directory. Keep one API worker while using this implementation's per-corpus process locks.

## Optional features

- **URL ingestion.** Set `ENABLE_URL_INGESTION=true` and configure comma-separated exact HTTPS hostnames in `URL_ALLOWED_HOSTS`. Enable the UI with `VITE_ENABLE_URL_INGESTION=true` at build time. URLs must resolve exclusively to public addresses and return HTML or plain text directly over HTTPS. The importer skips redirects and limits response size. Keep network egress restrictions in place on hosted deployments. [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- **Azure OpenAI.** Add exact HTTPS resource origins to `AZURE_ALLOWED_ENDPOINTS`, comma separated. Enter that resource origin and the chat and embedding deployment names in the UI as applicable. Use operator-approved endpoints and network egress policy.
- **Pinecone.** Set `PINECONE_API_KEY` and `PINECONE_INDEX` on the API. Provision an index whose dimension matches the selected embedding model. A corpus namespace is derived from its server-issued ID. Changing the configured Pinecone index requires rebuilding affected corpora.
- **Hugging Face.** The default container includes API embeddings. For CPU embeddings in a native installation, use the optional requirements file and set `HUGGINGFACE_ALLOWED_MODELS` to approved model IDs. Budget memory for model loading.

## Upgrading from the prototype

1. Stop ingestion and back up the old database and data directory. The v2 API creates new `rag_*` tables and stores local indexes in `corpora/`. It leaves the old tables and indexes available for offline backup or export.
2. Configure a workspace token and create a new session from the UI. Re-upload original files to build an index for the selected embedding model. Old browser IDs did not prove ownership, so v2 does not assign those sessions automatically. The previous FAISS snapshots use a legacy serialization format and the app will not load them.
3. When using Compose, the new named volume starts fresh. For later releases, back up the database and corpus directory together during a maintenance window with the API stopped. Restore a matching pair and run the upload-and-query smoke test.

The app stores extracted passages in its indexes, plus source labels, excerpts and messages. Keep the original files if future re-indexing matters. For a private pilot, set a retention policy for the live volume, backups and any Pinecone namespaces before accepting sensitive data. Use the workspace operator to coordinate removal across those stores.

## Release checks

1. Run the backend test suite and the frontend production build. Build and start the actual Docker images in the target environment and verify `/health` and authenticated `/ready`.
2. With a test workspace, ingest two synthetic files in separate requests and retrieve a fact from each. Try a duplicate upload, then reload and reconnect to verify history and source restoration.
3. Repeat the ingest and query with each provider/store combination you intend to enable. Confirm that a token from a different workspace cannot open or search the test session. Verify network egress and check that neither logs nor error responses contain credentials.
4. Verify a backup and restore before a persistent pilot. A deployment requiring multiple API workers needs cross-worker write coordination and shared storage before scaling.

## Admin-demo server-managed provider keys

The `admin` demo login can choose **Use configured server key** in Model settings when that provider is configured on the API. It can also choose **Use my own API key** at any time. Workspace-token users never receive the server-key option and the API rejects any attempt to request it.

Set only the providers you want to offer in the backend host's secret environment: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, and/or `AZURE_OPENAI_API_KEY`. Do not set them as Vercel `VITE_*` variables. The API returns provider names only, never key values. For server-key mode with a different embedding provider, configure a server key for both the chat and embedding providers. Hugging Face embeddings require no provider key.

A server-managed key bills the account that owns that key. Use the option only for a restricted admin/demo workspace, not for public or untrusted users. Rotate a provider key in the host environment and redeploy if it is exposed.
