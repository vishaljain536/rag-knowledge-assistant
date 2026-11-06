# Changelog

## Unreleased

### Added

- Three landscape themes with preview thumbnails and a preference that persists across visits. Moonlit Observatory and Ember Canyon use new original artwork.
- Six-second landscape loops bring downhill water flow, lake reflections, aurora, and sweeping canyon sunlight to the sign-in screen and workspace welcome card. The Theme menu can turn background motion off, and the app uses still artwork for reduced motion.
- An optional Three.js scene adds pointer-controlled parallax and depth to landscape backgrounds. The scene loads on interaction, renders while moving or resizing, and keeps the artwork static for touch, reduced-motion, or unsupported devices.
- A cinematic sign-in screen and dark research workspace with original archive artwork. The loopback preview supports a fixed username and password when explicitly enabled on the API.
- An in-app documentation reader for the changelog, code walkthrough, overview, deployment instructions, and project guide. The views use the repository Markdown as their source and support shareable links.
- A source library with drag-and-drop uploads, preflight file checks, and search for longer source lists. Answers have copy controls and expandable evidence passages.
- Workspace bearer tokens, separate operator access for logs, server-issued session IDs, and workspace-scoped session and history APIs.
- Source records with stable content-based IDs, passage counts, and browser restoration of indexed sources and recent chat after reconnecting.
- Configuration for distinct Azure chat and embedding deployments, approved Azure endpoints, approved Hugging Face models, and server-owned Pinecone namespaces.
- Bounded, opt-in HTTPS import with an exact host allowlist, validated DNS results, IP-pinned TLS, redirect rejection, and response limits.
- A backend regression suite, authenticated readiness check, pinned core backend dependencies, static frontend Docker build, and a [code walkthrough](CODE_WALKTHROUGH.md).

### Changed

- Desktop uses dedicated workspace, chat, and source panes. Mobile puts sign-in in the main view and exposes workspace, model, and source tools in a toolbar. Model credentials and advanced retrieval settings open in a keyboard-accessible panel.
- The chat composer stays visible while the transcript scrolls. The browser restores a failed question draft and offers a jump to the latest messages.
- Ingestion accepts text PDFs, DOCX, XLSX, UTF-8 CSV, TXT and Markdown. It rejects unsupported and empty sources and bounds request size, parser work and passage counts.
- The first ingestion binds the corpus to a store, chunking settings and embedding configuration. Settings or dimension mismatches require rebuilding in a new session.
- The chat graph rewrites likely follow-ups using bounded prior questions, abstains on empty retrieval or missing/invalid citation IDs, and returns only cited passages. Citations include available page or sheet locators.
- Compose uses one non-root API process, loopback port bindings and a named data volume. The frontend container serves a locked production build. Local Hugging Face dependencies are available separately for native installs.

### Fixed

- Workspace login and provider configuration are accessible on mobile.
- FAISS appends sources instead of replacing the earlier index. A new snapshot is written before switching the active pointer. Identical source uploads are deduplicated.
- Gemini text retrieval uses supported `gemini-embedding-001` in place of the retired `text-embedding-004`.
- Missing indexes or failed model requests no longer leave a lone user message in history.

### Security

- Workspace ownership is checked before retrieval, history access or ingest. Operator logs require their own token. Provider credentials are omitted from validation error bodies.
- FAISS snapshots store JSON metadata and native vectors with an integrity digest. The app no longer loads pickle metadata or legacy session indexes.
- The browser keeps credentials in memory. It stores only the last selected session ID for restoration.

### Upgrade

- Configure `WORKSPACE_TOKENS` and reconnect through the updated frontend. Set `ADMIN_TOKEN` separately if you need operational logs.
- Existing prototype tables and indexes are left in place for backup or offline export. Create a new workspace session and re-upload source files. Browser-issued prototype IDs cannot establish ownership.
- Follow the [deployment guide](DEPLOYMENT.md#upgrading-from-the-prototype) for storage and backup changes.

### Verification

- Passed 26 backend regression cases using real SQLite, FAISS and Chroma, including the loopback and operator access checks for preview sign-in. Constructed the seven hosted chat adapters with synthetic credentials. Provider API calls and Pinecone writes were simulated.
- Passed the frontend production build and desktop and mobile Chromium smoke tests. Verified workspace access, uploads, first-source retrieval after a second upload, evidence, clipboard copy, chat restoration, and documentation deep links.
- Validated Compose configuration. Docker image builds, hosted deployment, and credentialed provider calls require the [release checks](DEPLOYMENT.md#release-checks) in the target environment.
