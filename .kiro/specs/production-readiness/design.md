# Production Readiness Design

## Current-state assessment

The repository is a functional local prototype:

- React/Vite frontend submits sources, provider settings, and questions.
- FastAPI extracts text, builds a FAISS, Chroma, or Pinecone index, then uses LangGraph to retrieve and answer.
- SQLite stores conversation messages.
- Docker Compose runs an API container and a Vite development server.

The prototype is unsafe as a shared service because a request controls `session_id`, URL fetch targets, and Pinecone resources. The default FAISS flow also overwrites the prior index whenever sources are added.

## Design principles

1. Treat all client data, uploaded content, retrieved passages, URLs, and resource identifiers as untrusted.
2. Derive ownership from server authentication, never a browser-generated identifier.
3. Record corpus configuration at creation and use it consistently for later retrieval.
4. Use stable public error codes and keep internal details in structured, redacted logs.
5. Support trusted local development without weakening shared-deployment safeguards.

## Proposed architecture

```text
Browser
  | authenticated request / approved local mode
Reverse proxy / HTTPS boundary
  |
FastAPI
  |-- identity and workspace context
  |-- source validation
  |    |-- safe upload limits and extraction budgets
  |    `-- SSRF-safe HTTP fetcher
  |-- corpus service
  |    |-- corpus metadata and ownership
  |    `-- immutable index configuration
  |-- vector-store adapter
  |    |-- incremental FAISS or Chroma operations
  |    `-- server-mapped Pinecone index and namespace
  |-- RAG workflow
  `-- relational database with migrations
```

## Identity and ownership model

### Decision gate

Select the deployment mode before implementation:

- **Private single-tenant:** authenticate every non-health request through a reverse-proxy identity header verified by the API, or a configured application access key. The server maps it to a fixed workspace.
- **Multi-user:** integrate an approved OIDC provider. The API verifies issuer, audience, signature, expiry, and user/workspace claims.

### Common API contract

Regardless of mode:

- Introduce an `ActorContext` dependency created from authentication.
- Replace client-controlled `session_id` with a server-issued `conversation_id` and a server-issued `corpus_id` that are UUIDs.
- Query every conversation/corpus/index record with the authenticated owner/workspace constraint.
- Never use any public identifier directly as a path. Local paths use internal database IDs or validated UUID values, resolve under one dedicated root, and are checked with `is_relative_to` before filesystem operations.

## Data model

Use a migration framework such as Alembic and extend the relational model:

| Entity | Key fields | Purpose |
| --- | --- | --- |
| Workspace | `id`, `external_subject`, `created_at` | Security boundary for single-tenant or multi-user modes. |
| Corpus | `id`, `workspace_id`, `name`, `store_type`, `embedding_provider`, `embedding_model`, `chunk_size`, `chunk_overlap`, `state` | Owns sources and immutable retrieval configuration. |
| Source | `id`, `corpus_id`, `original_name`, `source_type`, `content_hash`, `status`, `metadata_json` | Records safely accepted sources and extraction result. |
| Conversation | `id`, `workspace_id`, `corpus_id`, `title`, `created_at` | Groups messages and ties them to an owner/corpus. |
| Message | `id`, `conversation_id`, `role`, `content`, `citations_json`, `created_at` | Preserves chat records with a foreign key. |

Add unique constraints where necessary, including the external subject to workspace mapping. Foreign keys must be enabled and indexed for ownership filters.

## Safe URL ingestion

Implement a dedicated URL fetcher rather than using `httpx` directly from a request field:

1. Parse and require an absolute HTTP(S) URL with no embedded credentials.
2. Resolve the hostname using the runtime resolver.
3. Reject every resolved address that is loopback, private, link-local, multicast, unspecified, reserved, or otherwise non-global.
4. Connect only to an approved resolved public address where practical. Revalidate each redirect URL and target.
5. Set strict maximums for redirects, response headers, body bytes, and timeouts.
6. Permit only textual / HTML content types for the first release.
7. Return extracted text only after the full validation sequence succeeds.

The implementation must have direct regression coverage for literal private addresses, DNS-resolved private addresses, and redirects from a public endpoint to a blocked address.

## Source extraction controls

Create a registry of supported handlers keyed by extension and verified content type. Reject unknown suffixes instead of decoding arbitrary bytes as text.

Apply limits before and during extraction:

- Request file count and aggregate bytes.
- Per-file bytes, PDF pages, spreadsheet sheets/rows, and extracted characters.
- Total chunks per corpus operation.

For the first hardened release, remove `.xls` from UI/config/API support unless a tested compatible parser is introduced. Mark image uploads as unsupported for semantic extraction until an OCR or provider-specific vision pipeline is implemented. The UI should communicate the limitation before upload.

## Index lifecycle

### Metadata

Persist vector-store type, embedding provider/model, vector dimension when available, and chunking values on `Corpus`. The chat endpoint uses stored values, not mutable browser settings.

### FAISS

For an existing corpus, load the trusted application-created index, add new documents, and save atomically through a temporary directory or file replacement. If an index is absent, create it. Never use a user-derived storage location.

Because FAISS persistence uses serialized artifacts, the app must treat the index directory as trusted private server data. Avoid dangerous deserialization when the selected FAISS/version API permits it. If an exception is unavoidable, enforce fixed ownership, an application-only path, integrity validation, and no user write access to the index directory.

### Chroma and Pinecone

Use a corpus-generated collection/namespace. Map each workspace/corpus to server-configured Pinecone resources. The client must not submit arbitrary index names or namespaces. A provider-resource mismatch must be detected before query or insertion.

## API changes

Replace the current ad hoc endpoints with ownership-aware equivalents:

| Operation | Proposed route | Notes |
| --- | --- | --- |
| Create corpus | `POST /corpora` | Validates creation settings and records immutable metadata. |
| Add files | `POST /corpora/{corpus_id}/sources/files` | Authenticated, bounded, and type-validated. |
| Add URL | `POST /corpora/{corpus_id}/sources/url` | Uses safe URL fetcher. |
| Create conversation | `POST /corpora/{corpus_id}/conversations` | Server issues ID tied to actor. |
| Chat | `POST /conversations/{conversation_id}/messages` | Uses conversation corpus configuration. |
| Read messages | `GET /conversations/{conversation_id}/messages` | Ownership-filtered, paginated. |

Keep `/health` unauthenticated and return no sensitive detail. Use a consistent response shape such as `{ "error": { "code", "message", "request_id" } }` for expected failures. Preserve intentional HTTP errors rather than converting every exception into `400`.

## Frontend changes

- Stop generating the only session identity in a module-level `crypto.randomUUID()`.
- Create/select a server-issued corpus and conversation after authentication.
- Load owned conversation history on page entry.
- Disable chat until the selected corpus reports indexed sources.
- Display support limitations accurately, particularly images and legacy `.xls`.
- Keep API keys out of persisted browser storage. In server-key mode, do not render provider-key fields at all.

## Deployment design

Use a multi-stage frontend Docker build:

1. Copy `package.json` and `package-lock.json`.
2. Run `npm ci`.
3. Build static assets.
4. Serve them using a non-root production web server with a health endpoint and SPA fallback.

Pin frontend package versions and use the lockfile. Pin backend dependencies to reviewed compatible versions. Document a reverse proxy that terminates TLS, forwards only intended routes, limits request body size, and injects/verifies the approved authentication boundary.

SQLite and local FAISS/Chroma remain acceptable only for a single replica and a mounted, access-controlled volume. Shared/replicated deployments require a managed relational database and an appropriate vector-store strategy.

## Verification strategy

Implement backend API tests for security and core behavior, frontend checks for the changed API contract, and container smoke checks. At a minimum cover:

- blocked SSRF requests and redirects;
- authentication and cross-workspace isolation;
- invalid public IDs and path escape attempts;
- incremental FAISS indexing;
- empty-corpus chat;
- invalid chunk options and mismatched index settings;
- unsupported/oversized/malformed source handling;
- image and `.xls` user-visible capability rules;
- reproducible image build and `/health` response.

## Rollout

1. Do not publicly expose the current prototype.
2. Implement input and ownership boundaries first.
3. Migrate existing local SQLite/index data only if it contains valuable data; otherwise start fresh with the new schema.
4. Enable production deployment only after automated checks, manual security review, backups, and HTTPS/auth configuration have been verified.
