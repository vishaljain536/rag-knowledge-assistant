import csv
import io
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from langchain_core.documents import Document as LCDocument
from openpyxl import load_workbook
from pypdf import PdfReader

from .errors import ApiError
from .operational_logs import log_event


MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_UPLOAD_BYTES = 48 * 1024 * 1024
MAX_FILES = 8
MAX_TEXT_CHARS = 500_000
MAX_PAGES = 250
MAX_ROWS = 10_000
MAX_COLUMNS = 128
MAX_SHEETS = 20
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024
FILE_TYPES = {".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md"}


@dataclass
class ExtractedSource:
    id: str
    label: str
    documents: list[LCDocument]


def _too_complex() -> ApiError:
    return ApiError(413, "source_too_complex", "The source exceeds the extraction limits.")


def _text(content: bytes) -> str:
    text = content.decode("utf-8-sig")
    if any(ord(char) < 32 and char not in "\t\r\n" for char in text):
        raise ValueError("Binary characters in text")
    return text


def _check_office_package(content: bytes, required_member: str) -> None:
    with ZipFile(io.BytesIO(content)) as archive:
        members = archive.infolist()
        if len(members) > 2000 or sum(member.file_size for member in members) > MAX_ARCHIVE_BYTES:
            raise _too_complex()
        archive.getinfo(required_member)


def _csv_text(content: bytes) -> str:
    lines = []
    for number, row in enumerate(csv.reader(io.StringIO(_text(content)), strict=True), 1):
        if number > MAX_ROWS or len(row) > MAX_COLUMNS:
            raise _too_complex()
        lines.append(" | ".join(row))
    return "\n".join(lines)


def _spreadsheet(content: bytes):
    _check_office_package(content, "xl/workbook.xml")
    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True, keep_links=False)
    try:
        if len(workbook.sheetnames) > MAX_SHEETS:
            raise _too_complex()
        rows_read = 0
        for sheet in workbook.worksheets:
            if (sheet.max_column or 0) > MAX_COLUMNS:
                raise _too_complex()
            lines = []
            chars = 0
            # Ignore declared row dimensions, which can be missing or inaccurate.
            sheet.reset_dimensions()
            for row in sheet.iter_rows(values_only=True):
                rows_read += 1
                if rows_read > MAX_ROWS or len(row) > MAX_COLUMNS:
                    raise _too_complex()
                line = " | ".join("" if cell is None else str(cell) for cell in row).strip(" |")
                chars += len(line) + 1
                if chars > MAX_TEXT_CHARS:
                    raise _too_complex()
                if line:
                    lines.append(line)
            yield "\n".join(lines), {"sheet": sheet.title}
    finally:
        workbook.close()


def _parts(suffix: str, content: bytes):
    if suffix == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF header")
        pdf = PdfReader(io.BytesIO(content))
        if pdf.is_encrypted:
            raise ApiError(422, "encrypted_pdf", "Unlock the PDF before uploading it.")
        if len(pdf.pages) > MAX_PAGES:
            raise _too_complex()
        for number, page in enumerate(pdf.pages, 1):
            yield page.extract_text() or "", {"page": number}
    elif suffix == ".docx":
        _check_office_package(content, "word/document.xml")
        doc = Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            paragraphs.extend(" | ".join(cell.text for cell in row.cells) for row in table.rows)
        yield "\n".join(paragraphs), {}
    elif suffix == ".xlsx":
        yield from _spreadsheet(content)
    elif suffix == ".csv":
        yield _csv_text(content), {}
    else:
        yield _text(content), {}


def extract_upload(name: str, content: bytes) -> ExtractedSource:
    name = Path(name.replace("\\", "/")).name[:255]
    suffix = Path(name).suffix.lower()
    if suffix not in FILE_TYPES:
        raise ApiError(415, "unsupported_file", "Upload a text PDF, DOCX, XLSX, CSV, TXT, or Markdown file.")
    if len(content) > MAX_FILE_BYTES:
        raise ApiError(413, "file_too_large", "Each file must be at most 25 MiB.")
    documents = []
    chars = 0
    try:
        for text, metadata in _parts(suffix, content):
            text = text.strip()
            chars += len(text)
            if chars > MAX_TEXT_CHARS:
                raise _too_complex()
            if text:
                documents.append(LCDocument(page_content=text, metadata=metadata))
    except ApiError:
        raise
    except Exception as exc:
        log_event("warning", "source.parse_failed", "File parser rejected input", error_type=type(exc).__name__)
        raise ApiError(422, "invalid_file", "The file could not be read as the declared format.") from exc
    if not documents:
        raise ApiError(422, "empty_source", "No text was found. Image-only documents require OCR first.")
    source_id = sha256(suffix.encode("ascii") + b"\0" + content).hexdigest()
    return ExtractedSource(source_id, name, documents)
