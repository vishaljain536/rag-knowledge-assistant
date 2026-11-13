# Deployment

Use one FastAPI process for a private pilot. The frontend can be served from Vercel or from the Docker image built by Compose.

## Accounts and access

Users sign in as a guest, with email and password, or with Google. Each user gets a private workspace: their sessions, sources and transcripts are not visible to anyone else. The API issues a random bearer token on sign-in and stores only its SHA-256 digest. User tokens expire after 30 days and admin tokens after 12 hours; signing out revokes the token. Passwords are hashed with scrypt and a per-user salt. Repeated failed sign-ins to one account are throttled.

- **Admin.** Set `DEMO_ADMIN_PASSWORD` to a strong secret (`python -c "import secrets; print(secrets.token_urlsafe(24))"`) and optionally `ADMIN_USERNAME` (default `admin`). The admin signs in at `<frontend>/#admin`, which the user sign-in screen does not link to. The admin can view the user list, read `/logs`, and choose server-managed provider keys.
- **Google.** Optional. Create a Google Cloud OAuth client of type **Web application**, add each frontend origin under **Authorized JavaScript origins**, and set the client ID as `GOOGLE_CLIENT_ID` on the API. Leave it empty to hide the Google button.
- **Scripts.** Optionally set `ADMIN_TOKEN` to a fixed 32–128 character token for scripts that read `/logs` and `/logs/stream`. It cannot open user sessions.

Provider keys are supplied per request and used for the selected provider. Keep the admin password, tokens and provider keys out of repository files and frontend build variables.

Use HTTPS between the browser and API on hosted deployments, restrict `CORS_ORIGINS` to the frontend origins, and apply connection and request-rate limits at the ingress. `GET /health` is public liveness. `GET /ready` checks database connectivity and the data directory for a signed-in caller.

## Deploy on Render and Vercel

1. Create the backend using [render.yaml](render.yaml). Supply `DEMO_ADMIN_PASSWORD`, optionally `GOOGLE_CLIENT_ID`, and set `CORS_ORIGINS` to the exact deployed Vercel origin. Wait for the Render health check to pass.
2. Set the Vercel project's root to the repository root. [vercel.json](vercel.json) installs the frontend lockfile and publishes its production build. Use Node.js 24 and set `VITE_API_URL` to the HTTPS backend origin.
3. Redeploy the frontend after changing any Vite build variable. Sign in as a guest and verify file ingestion and chat with synthetic content.

**Accounts need durable storage.** User accounts live in the same database as sessions. On Render's free plan the database is in `/tmp` and is erased whenever the service restarts, redeploys or spins down, so registered users and their sign-in history are lost. Point `DATABASE_URL` at a persistent database before relying on the user list.

The frontend also bundles selected Markdown files from the repository root for the in-app documentation. For a standalone frontend Docker build, run `docker build -f frontend/Dockerfile .` from the repository root. Docker Compose already uses that context.

The checked-in Render config stores SQLite and local FAISS/Chroma data in `/tmp/rag-data`, with an ephemeral filesystem. Use that configuration for disposable demos. Choose a persistent volume for a pilot with data that must survive restarts. Set both `DATA_DIR` and `DATABASE_URL` to the same volume. If using a bind mount, grant UID 10001 write access to the mounted directory. Keep one API worker while using this implementation's per-corpus process locks.

## Optional features

- **URL ingestion.** Set `ENABLE_URL_INGESTION=true` and configure comma-separated exact HTTPS hostnames in `URL_ALLOWED_HOSTS`. Enable the UI with `VITE_ENABLE_URL_INGESTION=true` at build time. URLs must resolve exclusively to public addresses and return HTML or plain text directly over HTTPS. The importer skips redirects and limits response size. Keep network egress restrictions in place on hosted deployments. [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- **Azure OpenAI.** Add exact HTTPS resource origins to `AZURE_ALLOWED_ENDPOINTS`, comma separated. Enter that resource origin and the chat and embedding deployment names in the UI as applicable. Use operator-approved endpoints and network egress policy.
- **Pinecone.** Set `PINECONE_API_KEY` and `PINECONE_INDEX` on the API. Provision an index whose dimension matches the selected embedding model. A corpus namespace is derived from its server-issued ID. Changing the configured Pinecone index requires rebuilding affected corpora.
- **Hugging Face.** The default container includes API embeddings. For CPU embeddings in a native installation, use the optional requirements file and set `HUGGINGFACE_ALLOWED_MODELS` to approved model IDs. Budget memory for model loading.

## Upgrading from the prototype

1. Stop ingestion and back up the old database and data directory. The v2 API creates new `rag_*` tables and stores local indexes in `corpora/`. It leaves the old tables and indexes available for offline backup or export.
2. Sign in and create a new session from the UI. Re-upload original files to build an index for the selected embedding model. Old browser IDs did not prove ownership, so v2 does not assign those sessions automatically. The previous FAISS snapshots use a legacy serialization format and the app will not load them.
3. When using Compose, the new named volume starts fresh. For later releases, back up the database and corpus directory together during a maintenance window with the API stopped. Restore a matching pair and run the upload-and-query smoke test.

The app stores extracted passages in its indexes, plus source labels, excerpts and messages. Keep the original files if future re-indexing matters. For a private pilot, set a retention policy for the live volume, backups and any Pinecone namespaces before accepting sensitive data. Use the admin to coordinate removal across those stores.

## Release checks

1. Run the backend test suite and the frontend production build. Build and start the actual Docker images in the target environment and verify `/health` and authenticated `/ready`.
2. With a test workspace, ingest two synthetic files in separate requests and retrieve a fact from each. Try a duplicate upload, then reload and reconnect to verify history and source restoration.
3. Repeat the ingest and query with each provider/store combination you intend to enable. Confirm that a different user cannot open or search the test session. Verify network egress and check that neither logs nor error responses contain credentials.
4. Verify a backup and restore before a persistent pilot. A deployment requiring multiple API workers needs cross-worker write coordination and shared storage before scaling.

## Admin server-managed provider keys

The admin can choose **Use configured server key** in Model settings when that provider is configured on the API. It can also choose **Use my own API key** at any time. Regular users never receive the server-key option and the API rejects any attempt to request it.

Set only the providers you want to offer in the backend host's secret environment: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, and/or `AZURE_OPENAI_API_KEY`. Do not set them as Vercel `VITE_*` variables. The API returns provider names only, never key values. For server-key mode with a different embedding provider, configure a server key for both the chat and embedding providers. Hugging Face embeddings require no provider key.

A server-managed key bills the account that owns that key. Use the option only for a restricted admin/demo workspace, not for public or untrusted users. Rotate a provider key in the host environment and redeploy if it is exposed.
