# Code walkthrough

## Read the repository in this order

1. [frontend/src/App.tsx](frontend/src/App.tsx) implements the workspace, provider settings, source uploads, transcript and citations.
2. [frontend/src/api.ts](frontend/src/api.ts) attaches the workspace bearer token and maps the form and chat requests onto the API contract. [frontend/src/types.ts](frontend/src/types.ts) defines the browser-side shapes.
3. [backend/app/main.py](backend/app/main.py) authenticates and bounds requests, assigns request IDs, sanitizes errors, and dispatches to the corpus service.
4. [backend/app/corpora.py](backend/app/corpora.py) owns the session lifecycle, profile checks, index publication and chat transaction.
5. [backend/app/rag.py](backend/app/rag.py) implements chunking, embedding dimension validation, storage and nearest-neighbor search. [backend/app/graph.py](backend/app/graph.py) builds the prompts, runs the chat graph and validates citation references.

## Frontend layout and state

`App.tsx` keeps the active session, credentials, draft, transcript, and source list in React state. The desktop app presents a workspace rail and a source library alongside the chat. The mobile toolbar opens native dialog panels for workspace, model, and source actions. Workspace sign-in lives in the main view at every viewport width.

[ModelSettings.tsx](frontend/src/ModelSettings.tsx) groups chat credentials and advanced retrieval options. It checks prerequisites before upload or chat, and keeps corpus settings fixed once the server supplies a profile. [SourceLibrary.tsx](frontend/src/SourceLibrary.tsx) shares one library between the desktop pane and the source dialog. It checks file type, count, and size before sending uploads. The backend applies its own validation.

The transcript follows new messages while the reader is near the bottom. When they scroll back, the composer offers a **Latest messages** control. Each answer can be copied and its numbered evidence passages can be opened individually. [SignIn.tsx](frontend/src/SignIn.tsx) renders the entry screen, [Icons.tsx](frontend/src/Icons.tsx) provides the SVG icon set, and [archive-falls.webp](frontend/public/archive-falls.webp) supplies the original generated artwork for the entry screen and the workspace welcome card.

**Use admin login** exchanges demo credentials for a process-scoped bearer token through `POST /preview/login`. The local account requires loopback and `ENABLE_LOCAL_DEMO_LOGIN=true`. Hosted demo access requires a configured HTTPS frontend origin and a server-side password. The local and hosted demo tokens open separate workspaces and have no operator access.

[ThemePicker.tsx](frontend/src/ThemePicker.tsx) stores the selected theme and motion preference locally and sets the palette at the document root. The sign-in screen, workspace, and documentation share those colors.

[Landscape.tsx](frontend/src/Landscape.tsx) uses the still WebP as its base layer. When the landscape is visible and motion is allowed, it loads the selected theme’s muted MP4 and reveals it once playback starts. Playback pauses when the background scrolls out of view or the tab is hidden. The still remains available if video playback fails. **Animate backgrounds** in the Theme menu turns off video; the device’s reduced motion setting takes precedence.

To regenerate the loops with Node.js and FFmpeg on your PATH, run `node frontend/scripts/render-landscape-loops.mjs <gif-output-directory>` from the repository root. You can append theme IDs to render only those themes. The [render script](frontend/scripts/render-landscape-loops.mjs) moves a repeating foam texture downhill within the waterfall and river. Moonlit Observatory uses small displacements to ripple the lake reflections. Ember Canyon sweeps light across the far cliffs and near arches, where drifting dust remains visible in a narrower crop. Each loop lasts six seconds. The script writes MP4s to the app’s public assets and GIFs to the directory you supply.

## In-app documentation

[DocsView.tsx](frontend/src/DocsView.tsx) uses Vite raw imports to render the repository Markdown. Routes such as `#docs/changelog` and `#docs/code-walkthrough` are shareable and work on static hosting. Links between the bundled documents stay in the app. Links to source files go to the repository. Returning to the workspace preserves the current tab's session and draft.

The documentation view loads separately from the workspace bundle. Update the Markdown files to change the site's documentation in the next frontend build. The frontend Docker image copies those files from the repository root.

## Identity, sessions and persistence

```text
Workspace token -> server-configured workspace slug
                       |
                       +-> RagSession UUID -> embedding profile + active snapshot
                                      |
                                      +-> Source rows -> indexed passages
                                      +-> Message rows -> recent transcript
```

[settings.py](backend/app/settings.py) loads configuration from the process environment and local dotenv when present. [access.py](backend/app/access.py) matches a bearer token to a configured workspace using digest comparison. A workspace token authenticates a group. An operator token is scoped to operational log endpoints. Provider keys authorize requests to model vendors and are independent of workspace access.

[models.py](backend/app/models.py) defines the tables. `rag_sessions` stores ownership and the retrieval profile. `rag_sources` has a composite key of session ID and source hash. `rag_messages` stores the role, text and serialized citations. `db.py` creates the database engine and enables SQLite foreign keys. The new tables use separate names from the prototype because the previous records have no authenticated owner. [db.py](backend/app/db.py) · [Upgrade steps](DEPLOYMENT.md#upgrading-from-the-prototype)

The browser calls `GET /sessions` after the user enters a token. It opens the last selected session if it belongs to this workspace and is in the returned list, otherwise it opens a recent session or creates one with `POST /sessions`. `GET /sessions/{id}` restores source and profile state. `GET /conversations/{id}` restores the latest 100 messages. The browser can safely retain a session ID because access still requires the workspace token.

## Upload to searchable source

1. **Validate the request.** The API authenticates before reading the body. The file endpoint limits concurrent imports and multipart fields and files. It checks declared request length and parsed file sizes before extraction. The corpus service looks up the session using both its UUID and the authenticated workspace. [main.py](backend/app/main.py) · [corpora.py](backend/app/corpora.py)
2. **Extract and identify sources.** `documents.py` validates extension and format, enforces parser limits, and returns extracted text with available PDF page or XLSX sheet metadata. A file source ID hashes the normalized extension and original bytes. The same file can be retried safely. URL sources use a separate fetcher, which validates the host and DNS answers, connects to the selected public IP, and uses the approved hostname for TLS verification. [documents.py](backend/app/documents.py) · [web_sources.py](backend/app/web_sources.py)
3. **Bind and chunk.** The first index write records the store, embedding provider/model, and chunk settings. Each chunk ID derives from the source hash and its position. The embedding wrapper checks that the adapter returns one vector per passage and that dimensions agree on writes and queries. Chat model selection can change independently. [schemas.py](backend/app/schemas.py) · [providers.py](backend/app/providers.py) · [rag.py](backend/app/rag.py)
4. **Publish.** With FAISS, the service loads the current verified snapshot, appends new passages, and writes a fresh snapshot with a unique filename. The file contains a JSON document table and native FAISS vector data. SQLite commits the pointer, SHA-256 digest, observed dimension and source rows together. A reader uses only the committed pointer and checks its digest before decoding the native index. The old snapshot is removed after commit. A crash between writing the file and committing may leave an unreferenced snapshot. Per-session locks coordinate publication and retrieval in the supported single API process. [rag.py](backend/app/rag.py) · [corpora.py](backend/app/corpora.py)
5. **Handle shared store semantics.** Chroma uses a corpus-specific local directory. Pinecone uses the server's configured index and a corpus-derived namespace. Both stores use stable chunk IDs. Queries filter to committed source IDs so an incomplete upsert cannot become visible as a source. A remote store can take time to make newly committed vectors searchable. [rag.py](backend/app/rag.py)

The parser and synchronous provider work run in a worker thread. Successful uploads return the authoritative source list and profile. A validation error or a failed index write leaves the existing source list intact.

## Question to cited answer

```text
POST /chat -> authenticate -> load owned session
      |
      +-> greeting -> canned reply
      |
      +-> document question -> check source availability and profile
                -> optionally rewrite a follow-up
                -> retrieve up to five passages
                -> abstain if retrieval is empty
                -> ask the chat model for a grounded answer
                -> validate citation numbers
      |
      +-> commit user and assistant messages in one transaction
```

`corpora.chat()` reads up to four prior user questions and caps each at 600 characters. The graph uses them to rewrite likely follow-ups such as “How much does it cost?” into a standalone retrieval query. The rewrite step receives prior questions and the current question. The answer step receives the rewritten question and numbered source passages. It treats extracted text as untrusted content.

The answer node accepts cited passage IDs that exist in that request. It returns an insufficient-evidence response for an explicit abstention or absent/out-of-range citation IDs. Valid citations include their prompt number, source ID, filename or URL label, locator where available, and passage text. A valid passage ID confirms which text the answer references. Human or evaluation review is still needed to measure whether each claim follows from the cited passage. [graph.py](backend/app/graph.py) · [schemas.py](backend/app/schemas.py)

## Settings and errors

- `ProviderSettings` validates credential combinations and approved deployment settings. `CorpusProfile` contains retrieval settings and provider identity without credentials. `providers.py` builds SDK adapters from the saved retrieval profile plus the credentials provided for the current request.
- Gemini's `gemini-embedding-001` supports the adapter's separate document and query task types. Gemini Embedding 2 uses a different request contract and embedding space. A future adapter for it needs its own tests and fresh indexes. [Google embedding API](https://ai.google.dev/gemini-api/docs/embeddings?authuser=117)
- `errors.py` defines API errors with safe messages. `main.py` emits a stable error code and request ID. Validation handlers use fixed messages because Pydantic can include the raw input object in its error details. Provider failure logs record exception types and the request ID without SDK exception text. [errors.py](backend/app/errors.py) · [operational_logs.py](backend/app/operational_logs.py)
- `/health` checks liveness. `/ready` checks the database connection and storage directory. [DEPLOYMENT.md](DEPLOYMENT.md) covers network controls, token rotation, storage and backups.

## Regression and quality checks

[backend/tests/test_api.py](backend/tests/test_api.py) exercises access control, core API flows, append and retry behavior, damaged snapshots, embedding profile checks, history and citations. [backend/tests/test_sources_and_providers.py](backend/tests/test_sources_and_providers.py) verifies extraction, the Gemini constructor and URL destination controls. Local tests use real SQLite, FAISS and Chroma, deterministic embeddings and simulated chat responses. Pinecone and outbound URL responses use test doubles.

For a live quality baseline, start with a small shareable fixture corpus and label expected passages and expected abstentions. Include exact identifiers, paraphrases, follow-ups, conflicting passages, spreadsheet lookups and instructions embedded in source text. Measure retrieval hit rate at five, answer correctness, citation support, abstention accuracy and p95 latency. This gives hybrid search and reranking experiments a baseline to compare against. [Release checks](DEPLOYMENT.md#release-checks)
