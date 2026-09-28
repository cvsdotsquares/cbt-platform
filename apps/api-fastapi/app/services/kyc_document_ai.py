"""Classify and check an uploaded KYC image before manual review."""

from __future__ import annotations

import base64
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

ALLOWED_DOCUMENT_TYPES = ("AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENSE")
DOCUMENT_LABELS = {
    "AADHAAR": "Aadhaar card",
    "PAN": "PAN card",
    "PASSPORT": "passport",
    "DRIVING_LICENSE": "driving licence",
}
_AUTO_VERIFY_CONFIDENCE = 0.8
_NAME_TITLES = {"mr", "mrs", "ms", "shri", "smt", "dr"}
_OPENAI_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
_OPENAI_ENV_NAMES = ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL")

_VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)

_CLASSIFY_INSTRUCTIONS = """You inspect one identity-document image for a school exam KYC check.
Classify it as exactly one of: AADHAAR, PAN, PASSPORT, DRIVING_LICENSE, UNKNOWN.
Extract the document number, the person's name, and the year of birth exactly as printed.
Do not invent digits, names, or years. If a field is unreadable or hidden, return an empty string.
On a driving licence, nameOnDocument is only the licence holder's name from the Name field.
Never use the Son/Daughter/Wife of line, or text marked S/O, D/O, W/O, or S/D/W. That line is a parent or spouse, not the holder.
dateOfBirthText is the birth field copied exactly as printed, including its label. Examples: "Year of Birth: 2004", "YOB: 2004", "DOB: 12/05/2004".
dateOfBirth is the four-digit year of birth only, such as 2004.
Read that year from "Year of Birth", "YOB", or the year inside a printed date of birth. Never return a day or month, and never invent 01/01/YYYY.
Aadhaar cards often print only the year of birth. That year is enough.
Set readable to true only when the document type, number, name, and year of birth can be read.
Set looksAuthentic to true only when the image is a clear photo or scan of that real document type, with its usual layout.
Set looksAuthentic to false for selfies, random photos, blank pages, screenshots of forms, heavily cropped images, or a different document.
confidence is a number from 0 to 1 for how sure you are of the type and that this is a genuine capture of that document.
Return JSON only:
{"documentType":"UNKNOWN","extractedIdNumber":"","nameOnDocument":"","dateOfBirth":"","dateOfBirthText":"","readable":false,"looksAuthentic":false,"confidence":0,"reason":""}
"""


class KycDocumentError(ValueError):
    """The upload itself cannot be read as a document."""


@dataclass
class KycAiDecision:
    document_type: str
    auto_verified: bool
    confidence: float
    extracted_id_number: str
    name_on_document: str
    date_of_birth: str = ""
    date_of_birth_precision: str = ""
    reasons: list[str] = field(default_factory=list)
    message: str = ""
    note: str = ""
    checked_at: str = ""

    def as_profile(self) -> dict:
        payload = {
            "outcome": "VERIFIED" if self.auto_verified else "MANUAL_REVIEW",
            "documentType": self.document_type,
            "confidence": round(self.confidence, 2),
            "extractedIdNumber": self.extracted_id_number,
            "nameOnDocument": self.name_on_document,
            "dateOfBirth": self.date_of_birth,
            "dateOfBirthPrecision": self.date_of_birth_precision,
            "reasons": self.reasons,
            "checkedAt": self.checked_at,
        }
        if self.note:
            payload["note"] = self.note
        return payload


def normalize_id(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def verhoeff_valid(number: str) -> bool:
    if not number.isdigit():
        return False
    checksum = 0
    for index, char in enumerate(reversed(number)):
        checksum = _VERHOEFF_D[checksum][_VERHOEFF_P[index % 8][int(char)]]
    return checksum == 0


def id_format_ok(document_type: str, id_number: str) -> bool:
    normalized = normalize_id(id_number)
    if document_type == "AADHAAR":
        return bool(re.fullmatch(r"\d{12}", normalized)) and normalized[0] not in "01" and verhoeff_valid(normalized)
    if document_type == "PAN":
        return bool(re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", normalized))
    if document_type == "PASSPORT":
        return bool(re.fullmatch(r"[A-Z][0-9]{7}", normalized)) or bool(
            re.fullmatch(r"[A-Z0-9]{6,12}", normalized)
        )
    if document_type == "DRIVING_LICENSE":
        return bool(re.fullmatch(r"[A-Z0-9]{8,20}", normalized))
    return False


_YEAR_ONLY_BIRTH = re.compile(
    r"^(?:(?:year\s+of\s+birth|birth\s+year|y\.?\s*o\.?\s*b\.?|dob|d\.?\s*o\.?\s*b\.?|date\s+of\s+birth)\s*[:\-]?\s*)?(19\d{2}|20\d{2})$",
    re.IGNORECASE,
)


def year_only_birth(value: str) -> str:
    """A printed year of birth, without a day or month."""
    raw = " ".join((value or "").replace(",", " ").split())
    match = _YEAR_ONLY_BIRTH.fullmatch(raw)
    if not match:
        return ""
    year = int(match.group(1))
    if 1900 <= year <= date.today().year:
        return str(year)
    return ""


def birth_year(value: str) -> str:
    """The four-digit year from a year-of-birth field or a full printed date."""
    year = year_only_birth(value)
    if year:
        return year
    parsed = parse_date_of_birth(value) if (value or "").strip() else ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", parsed):
        return parsed[:4]
    if re.fullmatch(r"\d{4}", parsed):
        return parsed
    return ""


def resolve_date_of_birth(printed: str, structured: str) -> tuple[str, str]:
    """Return the year of birth. A full printed date is reduced to its year."""
    year = birth_year(printed) or birth_year(structured)
    if year:
        return year, "year"
    return "", ""


def parse_date_of_birth(value: str) -> str:
    raw = re.sub(
        r"^(?:dob|date of birth|d\.?\s*o\.?\s*b\.?|year of birth|birth year|y\.?\s*o\.?\s*b\.?)\s*[:\-]?\s*",
        "",
        (value or "").strip(),
        flags=re.IGNORECASE,
    )
    raw = " ".join(raw.replace(",", " ").split())
    if not raw:
        return ""
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d %b %Y", "%d %B %Y"):
        try:
            parsed = datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
        if parsed.year < 1900 or parsed > date.today():
            return ""
        return parsed.isoformat()
    if re.fullmatch(r"\d{4}", raw):
        year = int(raw)
        if 1900 <= year <= date.today().year:
            return raw
    return ""


_GUARDIAN_SPLIT = re.compile(
    r"\b(?:s\s*/\s*o|d\s*/\s*o|w\s*/\s*o|s\s*/\s*d\s*/\s*w|son\s+of|daughter\s+of|wife\s+of)\b",
    re.IGNORECASE,
)
_NAME_LABEL = re.compile(r"^(?:name)\s*[:\-]\s*", re.IGNORECASE)


def driving_licence_holder_name(value: str) -> str:
    """Keep the licence holder's name and drop the guardian line."""
    text = " ".join((value or "").replace("\n", " ").split())
    text = _GUARDIAN_SPLIT.split(text, maxsplit=1)[0]
    return _NAME_LABEL.sub("", text).strip(" .,-:/")


def split_holder_name(full_name: str) -> tuple[str, str]:
    parts = [part for part in re.split(r"\s+", (full_name or "").strip()) if part]

    def titled(part: str) -> str:
        if any(char.islower() for char in part):
            return part
        return part.title()

    named = [titled(part) for part in parts]
    if not named:
        return "", ""
    if len(named) == 1:
        return named[0], ""
    return named[0], " ".join(named[1:])


def _name_tokens(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z]+", (value or "").lower())
        if len(token) >= 3 and token not in _NAME_TITLES
    ]


def names_loosely_match(profile_name: str, document_name: str) -> bool:
    profile_tokens = _name_tokens(profile_name)
    document_tokens = set(_name_tokens(document_name))
    if not profile_tokens or not document_tokens:
        return False
    return profile_tokens[0] in document_tokens


def _student_message(auto_verified: bool, document_type: str, reasons: list[str]) -> str:
    if auto_verified:
        label = DOCUMENT_LABELS.get(document_type, "identity document")
        return f"Your {label} was verified automatically."
    lead = reasons[0] if reasons else "This document could not be confirmed automatically."
    lead = (
        lead.replace("the number the student entered", "the number you entered")
        .replace("the student profile", "your profile")
        .rstrip(".")
    )
    return f"{lead}. An administrator will review it."


def manual_review_decision(reason: str, *, note: str = "") -> KycAiDecision:
    checked_at = datetime.now(timezone.utc).isoformat()
    reasons = [reason]
    return KycAiDecision(
        document_type="UNKNOWN",
        auto_verified=False,
        confidence=0,
        extracted_id_number="",
        name_on_document="",
        date_of_birth="",
        reasons=reasons,
        message=_student_message(False, "UNKNOWN", reasons),
        note=note[:240],
        checked_at=checked_at,
    )


def decide_kyc_auto_verification(
    *,
    model: dict,
    candidate_name: str,
) -> KycAiDecision:
    document_type = str(model.get("documentType") or "UNKNOWN").strip().upper()
    if document_type not in ALLOWED_DOCUMENT_TYPES:
        document_type = "UNKNOWN"
    try:
        confidence = float(model.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    confidence = min(1.0, max(0.0, confidence))
    readable = bool(model.get("readable"))
    authentic = bool(model.get("looksAuthentic"))
    extracted = str(model.get("extractedIdNumber") or "").strip()
    name_on_document = str(model.get("nameOnDocument") or "").strip()
    if document_type == "DRIVING_LICENSE":
        name_on_document = driving_licence_holder_name(name_on_document)
    raw_dob = str(model.get("dateOfBirth") or "").strip()
    printed_dob = str(model.get("dateOfBirthText") or "").strip()
    date_of_birth, date_precision = resolve_date_of_birth(printed_dob, raw_dob)
    note = str(model.get("reason") or "").strip()[:240]

    reasons: list[str] = []
    identified = (
        document_type in ALLOWED_DOCUMENT_TYPES
        and readable
        and authentic
        and confidence >= _AUTO_VERIFY_CONFIDENCE
    )
    if not identified:
        if document_type not in ALLOWED_DOCUMENT_TYPES:
            reasons.append(
                "Could not identify this file as an Aadhaar card, PAN card, passport, or driving licence"
            )
        else:
            reasons.append("The image is not clear enough to confirm the document")
    else:
        if not normalize_id(extracted):
            reasons.append("The document number could not be read")
        elif not id_format_ok(document_type, extracted):
            reasons.append("The document number does not look valid for this document type")
        if not _name_tokens(name_on_document):
            reasons.append("The name could not be read from the document")
        elif _name_tokens(candidate_name) and not names_loosely_match(candidate_name, name_on_document):
            reasons.append("The name on the document does not match the student profile")
        if not date_of_birth:
            reasons.append("The year of birth could not be read from the document")

    auto_verified = identified and not reasons
    checked_at = datetime.now(timezone.utc).isoformat()
    return KycAiDecision(
        document_type=document_type,
        auto_verified=auto_verified,
        confidence=confidence,
        extracted_id_number=extracted,
        name_on_document=name_on_document,
        date_of_birth=date_of_birth,
        date_of_birth_precision=date_precision,
        reasons=reasons,
        message=_student_message(auto_verified, document_type, reasons),
        note=note,
        checked_at=checked_at,
    )


def stored_mime_type(file_data: str, file_name: str) -> str:
    mime = ""
    if file_data.startswith("data:"):
        mime = file_data[5:].split(";", 1)[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime in {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}:
        return mime
    name = file_name.lower()
    if name.endswith(".pdf"):
        return "application/pdf"
    if name.endswith(".png"):
        return "image/png"
    if name.endswith(".webp"):
        return "image/webp"
    if name.endswith(".gif"):
        return "image/gif"
    if name.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    raise KycDocumentError("Upload a PDF or an image of the document (JPG, PNG, WEBP, or GIF).")


def _decode_data_url(file_data: str) -> tuple[str, bytes]:
    if not file_data.startswith("data:") or "," not in file_data:
        raise KycDocumentError("Upload a PDF or an image of the document.")
    header, encoded = file_data.split(",", 1)
    if ";base64" not in header.lower():
        raise KycDocumentError("Upload a PDF or an image of the document.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise KycDocumentError("The uploaded file could not be read.") from exc
    if not raw:
        raise KycDocumentError("The uploaded file is empty.")
    return header, raw


def _load_pdf_library():
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf  # type: ignore[no-redef]
    return pymupdf


def image_data_url_for_model(file_data: str, file_name: str) -> str:
    """Return a PNG or original image data URL the vision model can read."""
    stored_mime_type(file_data, file_name)
    _header, raw = _decode_data_url(file_data)
    if raw[:4] == b"%PDF" or file_name.lower().endswith(".pdf") or "application/pdf" in file_data[:40]:
        png = _pdf_first_page_png(raw)
        return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    mime = stored_mime_type(file_data, file_name)
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def _pdf_first_page_png(raw: bytes) -> bytes:
    pymupdf = _load_pdf_library()

    try:
        document = pymupdf.open(stream=raw, filetype="pdf")
    except Exception as exc:
        raise KycDocumentError("The PDF could not be read. Upload a clear image or a standard PDF.") from exc
    try:
        if document.page_count < 1:
            raise KycDocumentError("The PDF has no pages.")
        page = document.load_page(0)
        long_side = max(page.rect.width, page.rect.height) or 1
        scale = min(2.0, 1600 / long_side)
        scale = max(scale, 1.0)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        return pixmap.tobytes("png")
    except KycDocumentError:
        raise
    except Exception as exc:
        raise KycDocumentError("The PDF could not be read. Upload a clear image or a standard PDF.") from exc
    finally:
        document.close()


def _refresh_openai_settings() -> None:
    if not _OPENAI_ENV_FILE.is_file():
        return
    try:
        contents = _OPENAI_ENV_FILE.read_text(encoding="utf-8-sig")
    except OSError:
        return
    values: dict[str, str] = {}
    for raw_line in contents.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, raw_value = line.split("=", 1)
        name = name.strip()
        if name not in _OPENAI_ENV_NAMES:
            continue
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[name] = value.strip()
    if "OPENAI_API_KEY" in values:
        settings.OPENAI_API_KEY = values["OPENAI_API_KEY"]
    if values.get("OPENAI_BASE_URL"):
        settings.OPENAI_BASE_URL = values["OPENAI_BASE_URL"]
    if values.get("OPENAI_MODEL"):
        settings.OPENAI_MODEL = values["OPENAI_MODEL"]


def _parse_model_json(content: object) -> dict:
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content
        )
    text = str(content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("KYC model response was not an object")
    return parsed


def _vision_content_part(file_data: str, file_name: str) -> dict:
    mime = stored_mime_type(file_data, file_name)
    if mime == "application/pdf":
        try:
            image_url = image_data_url_for_model(file_data, file_name)
        except ImportError:
            safe_name = file_name.strip() or "document.pdf"
            if not safe_name.lower().endswith(".pdf"):
                safe_name = f"{safe_name}.pdf"
            return {"type": "file", "file": {"filename": safe_name, "file_data": file_data}}
        return {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}}
    image_url = image_data_url_for_model(file_data, file_name)
    return {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}}


async def _classify_document_image(content_part: dict) -> dict:
    _refresh_openai_settings()
    if not settings.OPENAI_API_KEY.strip():
        raise RuntimeError("OpenAI is not configured")
    base = (settings.OPENAI_BASE_URL or "https://api.openai.com/v1").strip().rstrip("/")
    if not base.startswith("http"):
        base = "https://api.openai.com/v1"
    payload = {
        "model": settings.OPENAI_MODEL or "gpt-4o-mini",
        "temperature": 0,
        "max_completion_tokens": 400,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _CLASSIFY_INSTRUCTIONS},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Identify this uploaded identity document and extract the name, document number, and year of birth.",
                    },
                    content_part,
                ],
            },
        ],
    }
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY.strip()}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        response = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
        response.raise_for_status()
        body = response.json()
    return _parse_model_json(body["choices"][0]["message"]["content"])


async def review_kyc_document(
    *,
    file_data: str,
    file_name: str,
    candidate_name: str,
) -> KycAiDecision:
    try:
        content_part = _vision_content_part(file_data, file_name)
    except KycDocumentError:
        raise
    except Exception:
        logger.exception("KYC document could not be prepared for automatic review")
        return manual_review_decision("The uploaded file could not be checked automatically")

    try:
        model = await _classify_document_image(content_part)
    except Exception:
        logger.exception("KYC automatic verification failed")
        return manual_review_decision("Automatic verification could not be completed")

    decision = decide_kyc_auto_verification(
        model=model,
        candidate_name=candidate_name,
    )
    logger.info(
        "KYC automatic review outcome=%s type=%s confidence=%.2f",
        "verified" if decision.auto_verified else "manual_review",
        decision.document_type,
        decision.confidence,
    )
    return decision
