# Production Readiness

## Purpose

Turn the current FastAPI + React RAG scaffold into a safe, reliable application for users beyond one trusted local developer. The current implementation supports local experimentation, but its URL ingestion, client-controlled sessions, and local-index lifecycle must be corrected before it is shared or publicly deployed.

## Scope

This spec covers:

- Secure source ingestion for uploads and public URLs.
- Server-owned identity, conversation, and corpus boundaries.
- Correct incremental indexing and stable retrieval configuration.
- Honest file-format and image capability handling.
- A reproducible, production-oriented deployment path.
- Automated regression coverage and operational documentation.

## Product decisions required

The implementation must not choose an external identity provider without product approval. Before the authentication task begins, choose one of these supported deployment modes:

1. **Single-tenant private deployment:** one server-owned workspace protected by an application access key or reverse-proxy authentication.
2. **Multi-user deployment:** authenticated user accounts through an approved identity provider, with each corpus and conversation owned by one user or organization.

Until a mode is selected, the app remains a local-development tool and must not be exposed to untrusted networks.

## Functional requirements

### R1. Restrict URL ingestion

- The API must accept only absolute `http` and `https` URLs.
- URL fetches must reject loopback, private, link-local, multicast, unspecified, and reserved IP addresses.
- Redirects must be revalidated before each request.
- The API must impose response-size, content-type, timeout, and redirect-count limits.
- Unsafe or unsupported sources must return a stable client-safe error and a useful server-side log entry.

### R2. Establish data ownership

- The server must derive the effective user/workspace identity from approved authentication, never from a client-supplied session identifier alone.
- Conversations, source collections, vector indexes, and uploaded data must be scoped to that identity.
- A user must not read, query, replace, or delete another user’s data.
- Public API requests must use validated, server-issued opaque identifiers rather than arbitrary filesystem path components.

### R3. Make ingestion and retrieval correct

- Adding sources to the default FAISS store must preserve previously indexed sources for the selected corpus.
- Retrieval must use the embedding configuration and vector-store type recorded when the corpus was created.
- The API must return a specific empty-corpus response when a user chats before ingestion.
- Stored conversation records must preserve database integrity through unique and foreign-key constraints.
- Invalid index settings, including overlap greater than or equal to chunk size, must be rejected before indexing.

### R4. Make supported-content claims accurate

- The UI and documentation must not list a format as supported unless it is actually extracted successfully.
- The initial secure release must either remove `.xls` support or add a compatible legacy spreadsheet extractor.
- Image and scanned-PDF support must either provide OCR/vision extraction or be clearly marked as source-only and unavailable for factual retrieval.
- File uploads must validate accepted extensions and content type before extraction and impose safe limits for file count, total request bytes, extracted text, pages, and chunks.

### R5. Protect storage and provider resources

- Users must not select arbitrary storage paths, Pinecone indexes, or unauthorized namespaces.
- Pinecone mappings must be controlled by server-side configuration and scoped to the authenticated workspace.
- Local persisted indexes must be protected from tampering; unsafe FAISS pickle loading must be removed or limited to trusted, validated files under application-controlled storage.
- Provider errors and internal exceptions must not expose secrets, paths, stack traces, or upstream implementation details to clients.

### R6. Provide a production deployment path

- The frontend production image must build static files from the lockfile and serve them through a production web server, not Vite’s development server.
- Dependency installation must be reproducible from pinned versions and lockfiles.
- Runtime configuration must document the supported credential model: browser-provided keys for private local use, or server-held keys for authenticated deployments.
- The deployment must include health/readiness checks, persistent-data guidance, and a documented HTTPS/reverse-proxy boundary.

### R7. Verify the release

- Automated coverage must protect source-validation, data-isolation, incremental-index, empty-corpus, and provider/index-validation behavior.
- Deployment validation must demonstrate that production images build and the health endpoint responds.
- Documentation must explain local mode, deployment mode, supported formats, model-key handling, backup, retention, and deletion responsibilities.

## Out of scope

- Streaming tokens and background ingestion jobs.
- OCR/vision implementation if product chooses to postpone it.
- Advanced RAG features such as reranking, evaluation datasets, and semantic cache.
- Full-scale multi-region infrastructure.

## Success criteria

The project is ready for an approved deployment mode when each R1–R7 acceptance condition has been demonstrated, the release checks pass, and no public endpoint accepts untrusted URLs, path fragments, workspace identifiers, or storage-resource identifiers without validation and authorization.
