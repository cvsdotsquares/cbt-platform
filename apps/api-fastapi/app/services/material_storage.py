import os
import re
import time
import logging
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.datastructures import UploadFile

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[2] / "uploads" / "materials"))
UPLOAD_READ_CHUNK = 1024 * 1024
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# pypdf caps zlib/flate output at 75MB by default; large textbook PDFs can exceed that.
PDF_DECOMPRESSION_MAX_BYTES = int(os.getenv("PDF_DECOMPRESSION_MAX_BYTES", "150_000_000"))
# pypdf on large textbooks is very slow; PyMuPDF should be installed for indexing.
PYPDF_FALLBACK_MAX_PAGES = int(os.getenv("MATERIAL_PYPDF_FALLBACK_MAX_PAGES", "80"))


async def save_material_upload_file(tenant_id: str, file_name: str, upload: "UploadFile") -> tuple[str, int]:
    """Stream upload to disk (avoids loading entire file into memory)."""
    safe_name = f"{int(time.time() * 1000)}-{re.sub(r'[^a-zA-Z0-9._-]', '_', file_name)}"
    tenant_dir = UPLOAD_DIR / tenant_id
    tenant_dir.mkdir(parents=True, exist_ok=True)
    file_path = tenant_dir / safe_name
    size = 0
    try:
        with file_path.open("wb") as out:
            while True:
                chunk = await upload.read(UPLOAD_READ_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ValueError("File exceeds 100 MB limit.")
                out.write(chunk)
    except Exception:
        if file_path.exists():
            file_path.unlink()
        raise
    return str(file_path.resolve()), size


def save_material_file(tenant_id: str, file_name: str, content: bytes, mime_type: str) -> str:
    safe_name = f"{int(time.time() * 1000)}-{re.sub(r'[^a-zA-Z0-9._-]', '_', file_name)}"
    tenant_dir = UPLOAD_DIR / tenant_id
    tenant_dir.mkdir(parents=True, exist_ok=True)
    file_path = tenant_dir / safe_name
    file_path.write_bytes(content)
    return str(file_path.resolve())


def read_material_file(file_url: str) -> bytes:
    path = Path(file_url)
    if not path.is_absolute():
        path = Path.cwd() / file_url
    if not path.exists():
        raise FileNotFoundError(file_url)
    return path.read_bytes()


def _pdf_decompression_limits() -> dict[str, int]:
    cap = PDF_DECOMPRESSION_MAX_BYTES
    return {
        "zlib_maximum_output_length": cap,
        "zlib_maximum_recovery_input_length": min(cap, 10_000_000),
        "lzw_maximum_output_length": cap,
        "jbig2_maximum_output_length": cap,
        "run_length_maximum_output_length": cap,
        "maximum_declared_stream_length": cap,
        "array_based_stream_maximum_output_length": cap,
        "image_maximum_buffer_size": cap,
    }


def pymupdf_available() -> bool:
    try:
        import pymupdf  # noqa: F401
        return True
    except ImportError:
        try:
            import fitz  # noqa: F401
            return True
        except ImportError:
            return False


_TOC_HEADER = re.compile(r"\b(table of contents|contents)\b", re.I)
_TOC_CHAPTER_LINE = re.compile(r"^(chapter\s+\d|\d{1,2}\s*[.)]\s)", re.I)


def _span_is_bold(span: dict) -> bool:
    flags = int(span.get("flags") or 0)
    if flags & (1 << 4):
        return True
    font = (span.get("font") or "").lower()
    return "bold" in font or "black" in font


def _page_toc_lines(page) -> list[str]:
    """Lines from a TOC/index page: bold headings and numbered chapter rows."""
    lines_out: list[str] = []
    try:
        page_dict = page.get_text("dict")
    except Exception:
        plain = (page.get_text("text") or "").strip()
        return [ln.strip() for ln in plain.splitlines() if ln.strip()]
    for block in page_dict.get("blocks") or []:
        if block.get("type") != 0:
            continue
        for line in block.get("lines") or []:
            spans = line.get("spans") or []
            if not spans:
                continue
            line_text = "".join(str(s.get("text") or "") for s in spans).strip()
            if not line_text or len(line_text) < 2:
                continue
            bold_len = sum(len(str(s.get("text") or "")) for s in spans if _span_is_bold(s))
            if bold_len >= max(3, len(line_text) * 0.35) or _TOC_CHAPTER_LINE.match(line_text):
                lines_out.append(line_text)
    return lines_out


def extract_pdf_for_material_index(
    content: bytes,
    *,
    body_max_pages: int = 36,
    toc_scan_pages: int = 25,
    toc_pages_after_header: int = 8,
) -> tuple[str, str]:
    """
    One pass over the PDF: body text for search chunks + TOC/index text for chapter list.
    TOC uses bold lines (and numbered rows) from contents pages only.
    """
    if not pymupdf_available():
        return "", ""
    doc = _open_pymupdf(content)
    try:
        total = doc.page_count
        body_end = min(total, max(body_max_pages, 0)) if body_max_pages else total
        body_parts = [(doc[i].get_text("text") or "") for i in range(body_end)]

        scan_end = min(total, max(toc_scan_pages, 1))
        toc_start = 0
        for i in range(scan_end):
            plain = doc[i].get_text("text") or ""
            if _TOC_HEADER.search(plain):
                toc_start = i
                break

        toc_end = min(total, toc_start + max(toc_pages_after_header, 1))
        toc_lines: list[str] = []
        for i in range(toc_start, toc_end):
            toc_lines.extend(_page_toc_lines(doc[i]))

        toc_text = "\n".join(toc_lines).strip()
        if len(toc_text) < 80:
            toc_text = "\n\n".join(
                (doc[i].get_text("text") or "") for i in range(toc_start, toc_end)
            ).strip()

        return "\n\n".join(body_parts).strip(), toc_text
    finally:
        doc.close()


def _open_pymupdf(content: bytes):
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf  # type: ignore[no-redef]
    return pymupdf.open(stream=content, filetype="pdf")


def _extract_pdf_with_pymupdf(content: bytes, *, max_pages: int | None = None) -> str | None:
    if not pymupdf_available():
        return None
    doc = _open_pymupdf(content)
    try:
        page_count = doc.page_count
        if max_pages is not None and max_pages > 0:
            page_count = min(page_count, max_pages)
        if page_count <= 0:
            return ""
        parts: list[str] = []
        for i in range(page_count):
            parts.append(doc[i].get_text("text") or "")
            if i > 0 and i % 25 == 0:
                logger.info("PDF extract progress: %s/%s pages", i + 1, page_count)
        return "\n\n".join(parts).strip()
    finally:
        doc.close()


def _extract_pdf_with_pypdf(content: bytes, *, max_pages: int | None = None) -> str:
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    from pypdf import PdfReader, apply_configuration
    from pypdf.errors import LimitReachedError

    page_texts: list[str] = []
    with apply_configuration(**_pdf_decompression_limits()):
        reader = PdfReader(BytesIO(content))
        limit = len(reader.pages)
        if max_pages is not None and max_pages > 0:
            limit = min(limit, max_pages)
        for index in range(limit):
            page = reader.pages[index]
            try:
                page_texts.append(page.extract_text() or "")
            except LimitReachedError as exc:
                logger.warning(
                    "Skipping PDF page %s during text extraction (decompression limit): %s",
                    index + 1,
                    exc,
                )
            except Exception as exc:
                logger.warning(
                    "Skipping PDF page %s during text extraction: %s",
                    index + 1,
                    exc,
                )
    return "\n\n".join(page_texts).strip()


def extract_material_text(
    file_url: str,
    mime_type: str,
    file_name: str,
    *,
    max_pages: int | None = None,
) -> str:
    content = read_material_file(file_url)
    is_pdf = mime_type == "application/pdf" or file_name.lower().endswith(".pdf")
    if is_pdf:
        extracted = _extract_pdf_with_pymupdf(content, max_pages=max_pages)
        if extracted is None:
            logger.warning(
                "PyMuPDF not installed; pypdf fallback is slow on large PDFs (%s). "
                "Install pymupdf for fast indexing.",
                file_name,
            )
            pypdf_cap = max_pages if max_pages and max_pages > 0 else PYPDF_FALLBACK_MAX_PAGES
            return _extract_pdf_with_pypdf(content, max_pages=pypdf_cap)
        if len(extracted) >= 200:
            return extracted
        logger.info(
            "PyMuPDF returned little text for %s; trying pypdf (max %s pages)",
            file_name,
            PYPDF_FALLBACK_MAX_PAGES,
        )
        pypdf_cap = max_pages if max_pages and max_pages > 0 else PYPDF_FALLBACK_MAX_PAGES
        fallback = _extract_pdf_with_pypdf(content, max_pages=pypdf_cap)
        return fallback if len(fallback) > len(extracted) else extracted
    return content.decode("utf-8", errors="replace").strip()


def extract_material_text_for_indexing(
    file_url: str,
    mime_type: str,
    file_name: str,
    *,
    body_max_pages: int | None = 36,
) -> tuple[str, str]:
    """
    Returns (body_text_for_chunks, syllabus_text_for_chapter_detection).
    PDFs: syllabus text prefers bold/index (contents) pages; body uses limited page count.
    """
    content = read_material_file(file_url)
    is_pdf = mime_type == "application/pdf" or file_name.lower().endswith(".pdf")
    if is_pdf and pymupdf_available():
        cap = body_max_pages if body_max_pages and body_max_pages > 0 else 36
        body, toc = extract_pdf_for_material_index(content, body_max_pages=cap)
        if body or toc:
            logger.info(
                "PDF index extract: file=%s body_chars=%s toc_chars=%s (bold/index pages)",
                file_name,
                len(body),
                len(toc),
            )
            return body, toc or body[:12_000]
    body = extract_material_text(
        file_url,
        mime_type,
        file_name,
        max_pages=body_max_pages,
    )
    return body, body[:12_000]


def chunk_material_text(text: str, chunk_size: int = 2400, overlap: int = 300) -> list[str]:
    # Collapsing whitespace on multi‑MB textbook strings is slow; chunk raw text when large.
    if len(text) > 800_000:
        cleaned = text.replace("\f", "\n").replace("\r\n", "\n").strip()
    else:
        cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(start + chunk_size, len(cleaned))
        chunks.append(cleaned[start:end])
        if end >= len(cleaned):
            break
        start = end - overlap
    return chunks


def delete_material_file(file_url: str) -> None:
    path = Path(file_url)
    if not path.is_absolute():
        path = Path.cwd() / file_url
    if path.exists():
        path.unlink()
