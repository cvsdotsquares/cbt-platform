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


def _extract_pdf_with_pymupdf(content: bytes) -> str | None:
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore[no-redef]
        except ImportError:
            return None
    doc = pymupdf.open(stream=content, filetype="pdf")
    try:
        return "\n\n".join(page.get_text("text") or "" for page in doc).strip()
    finally:
        doc.close()


def _extract_pdf_with_pypdf(content: bytes) -> str:
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    from pypdf import PdfReader, apply_configuration
    from pypdf.errors import LimitReachedError

    page_texts: list[str] = []
    with apply_configuration(**_pdf_decompression_limits()):
        reader = PdfReader(BytesIO(content))
        for index, page in enumerate(reader.pages):
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


def extract_material_text(file_url: str, mime_type: str, file_name: str) -> str:
    content = read_material_file(file_url)
    is_pdf = mime_type == "application/pdf" or file_name.lower().endswith(".pdf")
    if is_pdf:
        extracted = _extract_pdf_with_pymupdf(content)
        if extracted is None:
            logger.info("PyMuPDF not installed; using pypdf for %s", file_name)
            return _extract_pdf_with_pypdf(content)
        if len(extracted) >= 200:
            return extracted
        logger.info("PyMuPDF returned little text for %s; trying pypdf", file_name)
        fallback = _extract_pdf_with_pypdf(content)
        return fallback if len(fallback) > len(extracted) else extracted
    return content.decode("utf-8", errors="replace").strip()


def chunk_material_text(text: str, chunk_size: int = 2400, overlap: int = 300) -> list[str]:
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
