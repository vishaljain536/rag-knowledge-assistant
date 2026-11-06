# Global RAG Assistant project guide

Global RAG Assistant is a document question-answering app. It splits extracted text into passages, embeds those passages for search, and supplies the best matches to a chat model. SQLite keeps the workspace-scoped session, its source list and its transcript. Start with the [README](README.md) for setup and the [code walkthrough](CODE_WALKTHROUGH.md) for the implementation.

## What motivated the hardening work

The review on 6 November 2026 found several prototype behaviors that were reproducible with synthetic inputs. A second FAISS upload replaced the first index while the UI still showed both files. The Gemini embedding adapter pointed to a retired model. A failed question could leave a user-only message in SQLite. A request validation error echoed a synthetic provider key, and a caller who knew a session UUID could read its history without authenticating. The first revision also indexed image filenames as if they were source content.

The [changelog](CHANGELOG.md) records how the updated implementation addresses these issues. Its central model is one owned corpus and conversation per server-issued session. Its default deployment uses one API process with SQLite and local FAISS, while Chroma and server-configured Pinecone are available as additional stores.

## Priorities after the hardening changes

### 1. Verify a persistent private pilot

Run the [release checks](DEPLOYMENT.md#release-checks) against your chosen chat and embedding credentials and against the actual Docker or hosted release. Re-upload two synthetic files separately, query both, then restart against the persistent volume and reconnect. Practice restoring the database and index snapshots together. Record the results alongside the provider and model IDs used.

### 2. Measure evidence quality before changing retrieval

Create 25–40 labeled questions against a small, shareable corpus. Include exact identifiers, paraphrases, tables, follow-ups, conflicting passages, unsupported questions and instructions embedded in documents. Record which passage supports each answer, then track hit rate at five, answer correctness, citation support, abstention accuracy and p95 latency. Try hybrid keyword and vector search when the baseline misses identifiers. Try reranking when relevant chunks are retrieved but buried. Compare changes on the same cases. [Retrieval implementation](backend/app/rag.py) · [Grounded answer and citations](backend/app/graph.py)

### 3. Add source lifecycle and document capabilities as needed

Add source removal and re-indexing with consistent database and vector-store updates. Include a retention workflow covering stored passages, messages, remote namespaces and backups. For scans and images, add OCR that produces page-level evidence and test against representative documents. Use structured rows and columns for spreadsheet questions that require calculations. [Parser](backend/app/documents.py) · [Corpus service](backend/app/corpora.py)

### 4. Revisit identity and storage before expanding access

The current workspace token model suits a private pilot with known members. Add individual identity, auditability and migrations for a wider release. Multiple API workers need shared relational storage and cross-worker corpus write coordination. Large or slow ingestion jobs benefit from a durable job queue with status and retry handling. The existing spec describes the wider production model. [Production-readiness plan](.kiro/specs/production-readiness/tasks.md)
