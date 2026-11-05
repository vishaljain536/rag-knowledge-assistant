# RAG Knowledge Assistant

A beginner-friendly Retrieval-Augmented Generation demo. Upload PDF, TXT, or Markdown files, retrieve the most relevant passages with OpenAI embeddings, then ask questions grounded in those passages.

## Features

- Extract text from PDFs and read plain text or Markdown files.
- Split documents into overlapping chunks and build an in-memory embedding index.
- Rank chunks by cosine similarity for each question.
- Show citations with source filenames and PDF page numbers.
- Treat document excerpts as reference data, not instructions.

## Run locally

Requires Python 3.10+ and an OpenAI API key. Document text is sent to OpenAI for embeddings and answers. The index lives in Streamlit session memory and is rebuilt when files or indexing settings change.

1. Clone this repository and open the project folder.
2. Create a virtual environment: python -m venv .venv
3. Activate it (macOS/Linux: source .venv/bin/activate; Windows: .venv\Scripts\activate)
4. Install packages: pip install -r requirements.txt
5. Set your key in the terminal: macOS/Linux: export OPENAI_API_KEY=your-key; Windows PowerShell: $env:OPENAI_API_KEY="your-key"
6. Start the app: streamlit run app.py
7. Alternatively, paste the key into the password field in the app sidebar.

## How it works

1. The app extracts text and splits it into overlapping character chunks.
2. OpenAI creates an embedding vector for each chunk.
3. A question is embedded and compared with the chunks using cosine similarity.
4. The top matching passages are sent to the chat model with instructions to answer only from those excerpts.

## Notes

- Use documents you are allowed to process. Avoid uploading confidential data unless you have reviewed the provider's data terms.
- Scanned PDFs without a text layer need OCR before upload.
- This is a learning prototype: embeddings are not persisted and the index resets when the app session ends.
