# Production Readiness Tasks

> Do not expose the current application to untrusted users before completing Tasks 1–6 and the relevant verification in Task 9.

The current private-pilot implementation and its verification are documented in [the changelog](../../../CHANGELOG.md) and [the code walkthrough](../../../CODE_WALKTHROUGH.md). The checklist below describes the wider production design. The current release uses a combined corpus and conversation session, workspace bearer tokens, separate versioned tables with a documented fresh-start upgrade, and HTTPS imports that reject redirects. A migration framework, live provider and image verification, and a shared multi-worker release still require separate work.

- [ ] 1. Select the authentication and deployment mode
  - Confirm whether the first hardened release is a private single-tenant service or an authenticated multi-user service.
  - Approve the identity mechanism, token/header verification rules, server-managed provider-key policy, and data-retention owner.
  - Record the choice in the README and deployment configuration.
  - **Requirements:** R2, R5, R6

- [ ] 2. Add an ownership-aware domain model and database migrations
  - Introduce workspace, corpus, source, and server-issued conversation identifiers.
  - Add foreign keys, ownership indexes, and uniqueness constraints for the selected identity model.
  - Add Alembic migrations and a safe local-data migration or documented fresh-start procedure.
  - Replace the `session_id`-derived local index path with an application-owned corpus path that is validated after resolution.
  - **Requirements:** R2, R3, R5
  - **Depends on:** Task 1

- [ ] 3. Implement authentication and authorization boundaries
  - Add an `ActorContext` request dependency based on the approved mode.
  - Require it for every data, ingestion, and chat endpoint; retain unauthenticated `/health` only.
  - Scope corpus, source, conversation, and message queries to the actor workspace.
  - Remove client control of vector-store paths, Pinecone index names, and namespaces.
  - **Requirements:** R2, R5
  - **Depends on:** Tasks 1–2

- [ ] 4. Secure URL ingestion against SSRF
  - Replace direct `httpx` request handling with an allowlisted HTTP(S) fetcher.
  - Validate URL syntax and scheme; reject embedded credentials and non-public addresses.
  - Resolve hosts and reject loopback, private, link-local, multicast, unspecified, and reserved targets.
  - Revalidate every redirect and set strict redirects, timeout, content-type, header, and response-body limits.
  - Emit safe client error codes with redacted operational logs.
  - **Requirements:** R1, R5

- [ ] 5. Add safe, accurate file extraction
  - Build a supported-file handler registry with extension/content-type validation.
  - Enforce limits for file count, aggregate request size, individual file size, parser pages/rows/sheets, extracted text, and generated chunks.
  - Reject unsupported binary files instead of silently decoding them as text.
  - Remove `.xls` from the UI, API contract, and config unless a compatible parser with verification is added.
  - Mark image and scanned-PDF factual extraction as unavailable until OCR or a real multimodal pipeline exists.
  - **Requirements:** R4

- [ ] 6. Make index lifecycle and chat behavior correct
  - Persist immutable corpus retrieval settings and use them for indexing and querying.
  - Load, append to, and atomically save a trusted FAISS index instead of replacing prior sources.
  - Define consistent Chroma and Pinecone append/replace behavior through the corpus service.
  - Ensure a missing corpus/index yields an explicit client-safe response before a user message is persisted.
  - Add model validation requiring `chunk_overlap < chunk_size` and validate all provider/store combinations before work begins.
  - Prevent unsafe FAISS artifact loading or restrict it to application-controlled, integrity-checked files.
  - **Requirements:** R3, R5
  - **Depends on:** Task 2

- [ ] 7. Update the React client for server-owned resources
  - Replace browser-only UUID sessions with server-created corpus and conversation selection.
  - Load owned conversation history and bind a conversation to a selected corpus.
  - Use the new ownership-aware API routes and immutable corpus status.
  - Remove or hide browser provider-key inputs when the chosen deployment uses server-held keys.
  - Present file/image capability limitations before ingestion and clear status errors.
  - **Requirements:** R2, R3, R4, R6
  - **Depends on:** Tasks 3 and 6

- [ ] 8. Create a reproducible production deployment path
  - Pin compatible backend dependency versions after a resolution review.
  - Pin frontend versions and build with `npm ci` from `package-lock.json`.
  - Replace the Vite development-server container with a multi-stage static production build served by a non-root web server.
  - Add service health checks, restart policy, request-size guidance, persistent-data configuration, and HTTPS/reverse-proxy documentation.
  - State the supported database/vector-store topology for single-replica and shared deployments.
  - **Requirements:** R6

- [ ] 9. Add release verification and security regression coverage
  - Verify SSRF blocks literal, DNS-resolved, and redirect-to-private targets.
  - Verify authentication, owner isolation, invalid-ID rejection, and path traversal prevention.
  - Verify incremental FAISS ingestion, missing-index chat response, invalid chunk settings, and safe source limits.
  - Verify UI/API capability handling for images and legacy spreadsheet uploads.
  - Verify reproducible production image builds and `/health` readiness.
  - **Requirements:** R1–R7
  - **Depends on:** Tasks 3–8

- [ ] 10. Document and approve release operations
  - Update the README, `.env.example`, and deployment guide so they match the selected credential and deployment model.
  - Document HTTPS/auth prerequisites, supported sources, backup/restore, retention/deletion, monitoring, and incident contact ownership.
  - Complete a manual security review of exposed routes and provider/vector-store permissions.
  - **Requirements:** R6, R7
  - **Depends on:** Task 9
