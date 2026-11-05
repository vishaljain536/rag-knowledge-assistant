import io
import csv
from pathlib import Path
import httpx
from bs4 import BeautifulSoup
from docx import Document
from openpyxl import load_workbook
from pypdf import PdfReader
from langchain_core.documents import Document as LCDocument


TEXT_EXTENSIONS = {".txt", ".md", ".csv"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def extract_upload(name: str, content: bytes) -> list[LCDocument]:
    suffix = Path(name).suffix.lower()
    meta = {"source": name}
    if suffix == ".pdf":
        reader = PdfReader(io.BytesIO(content))
        return [LCDocument(page_content=page.extract_text() or "", metadata={**meta, "page": i + 1}) for i, page in enumerate(reader.pages)]
    if suffix == ".docx":
        doc = Document(io.BytesIO(content))
        return [LCDocument(page_content="\n".join(p.text for p in doc.paragraphs), metadata=meta)]
    if suffix in {".xlsx", ".xls"}:
        wb = load_workbook(io.BytesIO(content), data_only=True)
        output = []
        for sheet in wb.worksheets:
            rows = [" | ".join("" if cell is None else str(cell) for cell in row) for row in sheet.iter_rows(values_only=True)]
            output.append(LCDocument(page_content="\n".join(rows), metadata={**meta, "sheet": sheet.title}))
        return output
    if suffix == ".csv":
        text = content.decode("utf-8", errors="replace")
        return [LCDocument(page_content="\n".join(" | ".join(row) for row in csv.reader(io.StringIO(text))), metadata=meta)]
    if suffix in IMAGE_EXTENSIONS:
        # Image OCR/vision is performed by the selected chat model during answering.
        # Store an explicit source marker so the UI can show the image in citations.
        return [LCDocument(page_content=f"Image uploaded: {name}. Use image analysis when answering about its contents.", metadata={**meta, "image": True})]
    return [LCDocument(page_content=content.decode("utf-8", errors="replace"), metadata=meta)]


async def extract_url(url: str) -> list[LCDocument]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=20, headers={"User-Agent": "RAG-Knowledge-Assistant/1.0"}) as client:
        response = await client.get(url)
        response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    for unwanted in soup(["script", "style", "nav", "footer", "noscript"]):
        unwanted.decompose()
    title = soup.title.get_text(" ", strip=True) if soup.title else url
    text = soup.get_text(" ", strip=True)
    return [LCDocument(page_content=text, metadata={"source": url, "title": title})]
