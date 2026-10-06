"""Extract chapters/topics from uploaded PDF text (TOC-first, no silent catalog substitution)."""

from __future__ import annotations

import logging
import re

from app.services.ncert_syllabus_catalog import ExtractedChapter, ExtractedTopic

logger = logging.getLogger(__name__)

# TOC lives in the front matter; scanning multi‑MB textbook text with regex is very slow.
_SYLLABUS_TOC_SEARCH_CHARS = 250_000
_SYLLABUS_HEURISTIC_MAX_CHARS = 400_000

_BOILERPLATE = re.compile(
    r"^(foreword|preface|acknowledgement|about the book|constitution of india|"
    r"fundamental rights|fundamental duties|note to teachers|how to use|"
    r"credits|index|appendix)\b",
    re.I,
)
_TOC_SKIP = re.compile(
    r"^(page no\.?|pages?|unit \d|part [a-z]|section [a-z]|"
    r"learning outcomes|assessment|teacher'?s? book)\b",
    re.I,
)
_MATH_LINE = re.compile(r"^[0-9x+\-*/=()\s]{8,}$|^[sy]\s*=", re.I)
_SENTENCE_FRAGMENT = re.compile(r"\b(is|was|are|were|has|have|had)\b", re.I)
_JUNK_CHAPTER_TITLE = re.compile(
    r"^(fastapi|django|flask|uvicorn|starlette|pydantic|python|postgresql|sqlalchemy)$",
    re.I,
)


def normalize_text(text: str) -> str:
    cleaned = (text or "").replace("\r\n", "\n").replace("\f", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def is_unreadable_pdf_text(text: str) -> bool:
    normalized = normalize_text(text)
    if len(normalized) < 80:
        return True
    letters = sum(1 for c in normalized if c.isalpha())
    if letters < 40:
        return True
    return False


def _strip_toc_page_number(line: str) -> str:
    return re.sub(r"\s*\.{2,}\s*\d+\s*$", "", line).strip()


def _sanitize_heading(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    t = _strip_toc_page_number(t)
    t = re.sub(r"\s+\d{1,4}\s*$", "", t).strip()
    return t[:200]


def display_chapter_title(title: str | None) -> str:
    if not title:
        return ""
    return _sanitize_heading(title)


def _is_valid_chapter_title(title: str) -> bool:
    t = _sanitize_heading(title)
    if len(t) < 3 or len(t) > 120:
        return False
    if _BOILERPLATE.search(t):
        return False
    if _MATH_LINE.match(t):
        return False
    if len(t.split()) > 18:
        return False
    if _SENTENCE_FRAGMENT.search(t) and len(t.split()) > 10:
        return False
    if _JUNK_CHAPTER_TITLE.match(t):
        return False
    return True


def _dedupe_repeated_toc_line(line: str) -> str:
    trimmed = line.strip()
    half = len(trimmed) // 2
    if half > 12:
        first, second = trimmed[:half].strip(), trimmed[half:].strip()
        if first == second:
            return first
    return trimmed


def _looks_like_title_continuation(next_line: str, title_part: str) -> bool:
    n = next_line.strip()
    if not n or len(n) > 90:
        return False
    if re.match(r"^\d{1,2}\s*[.)]", n) or re.match(r"^chapter\s+\d", n, re.I):
        return False
    if title_part and n[0].islower():
        return True
    return len(n.split()) <= 8 and not n.endswith(".")


def merge_toc_continuation_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        while i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if not nxt:
                break
            numbered = bool(re.match(r"^\d{1,2}\s*[.)]\s+", line))
            next_is_entry = bool(re.match(r"^\d{1,2}\s*[.)]\s+", nxt)) or bool(
                re.match(r"^chapter\s+\d", nxt, re.I)
            )
            title_part = re.sub(r"^\d{1,2}\s*[.)]\s+", "", line)
            incomplete = (
                re.search(r"[:,-]\s*$", line)
                or (
                    numbered
                    and not re.search(r"\d{1,4}\s*$", line)
                    and len(nxt) < 90
                    and not next_is_entry
                )
                or (numbered and _looks_like_title_continuation(nxt, title_part))
            )
            if incomplete:
                line = f"{line} {nxt}"
                i += 1
            else:
                break
        merged.append(line)
        i += 1
    return merged


def _looks_like_toc_author_line(line: str) -> bool:
    """Skip author bylines under story titles (e.g. Flamingo contents pages)."""
    t = line.strip()
    if not t or len(t) > 72:
        return False
    lower = t.lower()
    if lower in ("contents", "table of contents"):
        return True
    if lower.startswith(("the ", "a ", "an ", "lost ", "deep ", "going ", "poets ")):
        return False
    if re.search(r"\blesson\b|\bspring\b|\bwater\b|\bplaces\b|\bindigo\b", lower):
        return False
    if re.match(r"^[A-Z][a-zA-Z\-'.]+(?:\s+[A-Z][a-zA-Z\-'.]+){1,3}$", t):
        return True
    if " and " in lower and re.match(r"^[A-Z]", t):
        return True
    return False


def parse_toc_unnumbered_story_lines(lines: list[str]) -> list[ExtractedChapter]:
    """NCERT readers: CONTENTS with story titles (no chapter numbers)."""
    merged = merge_toc_continuation_lines([ln.strip() for ln in lines if ln.strip()])
    start = 0
    for idx, raw in enumerate(merged):
        if re.match(r"^(table of )?contents$", raw.strip(), re.I):
            start = idx + 1
            break
    chapters: list[ExtractedChapter] = []
    num = 0
    for raw in merged[start:]:
        line = _dedupe_repeated_toc_line(raw)
        if not line:
            continue
        if _BOILERPLATE.search(line) or _TOC_SKIP.search(line):
            continue
        if re.search(r"not to be republished|\bncert\b", line, re.I):
            continue
        if _looks_like_toc_author_line(line):
            continue
        if not _is_valid_chapter_title(line):
            continue
        num += 1
        chapters.append(
            ExtractedChapter(
                number=num,
                title=_sanitize_heading(line),
                content="",
                topics=[],
            ),
        )
        if num >= 40:
            break
    return chapters if len(chapters) >= 2 else []


def _is_toc_page_number_line(line: str) -> bool:
    t = line.strip()
    if not t:
        return True
    if re.fullmatch(r"\d{1,3}", t):
        return True
    if re.fullmatch(r"[ivxlcdm]+", t, re.I):
        return True
    return False


def extract_toc_region(text: str) -> str:
    normalized = normalize_text(text)
    toc_search = normalized[:_SYLLABUS_TOC_SEARCH_CHARS]
    candidates: list[tuple[int, int]] = []
    for pattern in (
        r"\bTABLE OF CONTENTS\b",
        r"\bCONTENTS\b",
        r"\bContents\b",
    ):
        for match in re.finditer(pattern, toc_search, re.I):
            sample = normalized[match.start() : match.start() + 5000]
            numbered_inline = len(re.findall(r"(?m)^\s*\d{1,2}\s*[.)]\s+\S", sample))
            numbered_own_line = len(re.findall(r"(?m)^\s*\d{1,2}\.\s*$", sample))
            chapter_kw = len(re.findall(r"(?m)^\s*chapter\s+\d", sample, re.I))
            score = numbered_inline * 10 + numbered_own_line * 12 + chapter_kw * 8
            candidates.append((score, match.start()))
    if candidates:
        _, start = max(candidates, key=lambda x: x[0])
        return normalized[start : start + 12000]
    return normalized[:12000]


def _collect_topic_lines(merged: list[str], start_index: int) -> tuple[list[str], int]:
    topics: list[str] = []
    j = start_index + 1
    while j < len(merged):
        nxt = merged[j].strip()
        if not nxt:
            j += 1
            continue
        if re.match(r"^\d{1,2}\s*[.)]\s+", nxt) or re.match(r"^chapter\s+\d", nxt, re.I):
            break
        if _TOC_SKIP.search(nxt) or _BOILERPLATE.search(nxt):
            break
        if len(nxt) <= 100 and _is_valid_chapter_title(nxt):
            topics.append(_sanitize_heading(nxt))
        if len(topics) >= 8:
            break
        j += 1
    return topics, j - 1


def parse_toc_from_lines(lines: list[str]) -> list[ExtractedChapter]:
    chapters: list[ExtractedChapter] = []
    merged = merge_toc_continuation_lines([ln.strip() for ln in lines if ln.strip()])
    i = 0
    while i < len(merged):
        normalized = _dedupe_repeated_toc_line(merged[i])
        if not normalized or _TOC_SKIP.search(normalized) or _BOILERPLATE.search(normalized):
            i += 1
            continue
        if re.search(r"^click here to buy", normalized, re.I):
            break
        if re.match(r"^constitution of india", normalized, re.I):
            break
        if normalized.lower() == "appendix":
            break

        num_only = re.match(r"^(\d{1,2})\.\s*$", normalized)
        if num_only:
            num = int(num_only.group(1))
            title: str | None = None
            topic_titles: list[str] = []
            j = i + 1
            while j < len(merged):
                nxt = _dedupe_repeated_toc_line(merged[j].strip())
                if not nxt:
                    j += 1
                    continue
                if re.match(r"^(\d{1,2})\.\s*$", nxt):
                    break
                if re.match(r"^constitution of india", nxt, re.I) or nxt.lower() == "appendix":
                    break
                if _BOILERPLATE.search(nxt) or _TOC_SKIP.search(nxt):
                    j += 1
                    continue
                if _is_toc_page_number_line(nxt):
                    j += 1
                    continue
                if title is None and _is_valid_chapter_title(nxt):
                    title = _sanitize_heading(nxt)
                    j += 1
                    continue
                if title and _is_valid_chapter_title(nxt) and len(topic_titles) < 8:
                    topic_titles.append(_sanitize_heading(nxt))
                    j += 1
                    if j < len(merged) and _is_toc_page_number_line(merged[j].strip()):
                        j += 1
                    continue
                j += 1
            if title and 0 < num <= 40 and not any(c.number == num for c in chapters):
                topics = [
                    ExtractedTopic(title=t, content="", order_index=ti)
                    for ti, t in enumerate(topic_titles)
                ]
                chapters.append(
                    ExtractedChapter(number=num, title=title, content="", topics=topics),
                )
            i = j
            continue

        chapter_with_title = re.match(r"^chapter\s+(\d{1,2})\s+(.+)$", normalized, re.I)
        if chapter_with_title:
            num = int(chapter_with_title.group(1))
            title = _sanitize_heading(_strip_toc_page_number(chapter_with_title.group(2)))
            if 0 < num <= 40 and _is_valid_chapter_title(title) and not any(
                c.number == num for c in chapters
            ):
                topic_titles, end_i = _collect_topic_lines(merged, i)
                topics = [
                    ExtractedTopic(title=t, content="", order_index=ti)
                    for ti, t in enumerate(topic_titles)
                ]
                chapters.append(
                    ExtractedChapter(number=num, title=title, content="", topics=topics),
                )
                i = max(i + 1, end_i + 1)
                continue

        chapter_header = re.match(r"^chapter\s+(\d{1,2})\s*$", normalized, re.I)
        if chapter_header:
            num = int(chapter_header.group(1))
            title_parts: list[str] = []
            j = i + 1
            while j < len(merged):
                nxt = merged[j].strip()
                if not nxt or re.match(r"^chapter\s+\d", nxt, re.I) or re.match(
                    r"^\d{1,2}\s*[.)]", nxt
                ):
                    j -= 1
                    break
                if _TOC_SKIP.search(nxt):
                    break
                title_parts.append(nxt)
                j += 1
            title = _sanitize_heading(_strip_toc_page_number(" ".join(title_parts)))
            if 0 < num <= 40 and _is_valid_chapter_title(title) and not any(
                c.number == num for c in chapters
            ):
                chapters.append(
                    ExtractedChapter(number=num, title=title, content="", topics=[]),
                )
            i = j + 1
            continue

        for pattern in (
            r"^\s*(\d{1,2})\s*[.)]\s+(.+?)(?:\s*\.{2,}\s*\d+|\s+\d{1,3})?\s*$",
            r"^\s*(\d{1,2})\s+(.{3,120})$",
        ):
            m = re.match(pattern, normalized)
            if not m:
                continue
            num = int(m.group(1))
            title = _sanitize_heading(_strip_toc_page_number(m.group(2)))
            if not (0 < num <= 40 and _is_valid_chapter_title(title)):
                break
            if not any(c.number == num for c in chapters):
                topic_titles, end_i = _collect_topic_lines(merged, i)
                topics = [
                    ExtractedTopic(title=t, content="", order_index=ti)
                    for ti, t in enumerate(topic_titles)
                ]
                chapters.append(
                    ExtractedChapter(number=num, title=title, content="", topics=topics),
                )
                i = max(i + 1, end_i + 1)
            else:
                i += 1
            break
        else:
            i += 1

    if len(chapters) < 2:
        unnumbered = parse_toc_unnumbered_story_lines(lines)
        if len(unnumbered) >= 2:
            return unnumbered

    return sorted(chapters, key=lambda c: c.number)


def _extract_chapters_heuristic_body(text: str) -> list[ExtractedChapter]:
    pattern = re.compile(
        r"(?m)^(?:CHAPTER|Chapter|CH\.?|Ch\.?)\s*(\d{1,2})\s*[:\.\-\s]+(.+?)\s*$",
    )
    found: list[ExtractedChapter] = []
    for match in pattern.finditer(text):
        num = int(match.group(1))
        title = match.group(2).strip()
        if _is_valid_chapter_title(title):
            found.append(ExtractedChapter(number=num, title=title, content="", topics=[]))
    if found:
        return sorted({c.number: c for c in found}.values(), key=lambda c: c.number)
    return []


def extract_chapters_from_text(
    text: str,
    *,
    single_chapter: bool,
    fallback_title: str,
    class_level: int | None,
    subject_code: str | None,
    material_id: str | None = None,
    file_name: str | None = None,
) -> list[ExtractedChapter]:
    normalized = normalize_text(text)
    log_prefix = (
        f"[BOOK-EXTRACTION] materialId={material_id or '?'} fileName={file_name or '?'} "
        f"isFullBook={not single_chapter}"
    )
    logger.info("%s starting", log_prefix)

    if single_chapter:
        title = (fallback_title or "Chapter")[:120]
        return [
            ExtractedChapter(
                number=1,
                title=title,
                content=normalized[:8000],
                topics=[],
            )
        ]

    toc_region = extract_toc_region(normalized)
    toc_chapters = parse_toc_from_lines(toc_region.split("\n"))
    if len(toc_chapters) >= 2:
        logger.info(
            "%s extracted chapters=%s",
            log_prefix,
            [(c.number, c.title) for c in toc_chapters],
        )
        return toc_chapters

    heuristic = _extract_chapters_heuristic_body(normalized[:_SYLLABUS_HEURISTIC_MAX_CHARS])
    if len(heuristic) >= 2:
        logger.info(
            "%s extracted chapters=%s (heuristic)",
            log_prefix,
            [(c.number, c.title) for c in heuristic],
        )
        return heuristic

    if len(toc_chapters) == 1:
        logger.info("%s single TOC chapter=%s", log_prefix, toc_chapters[0].title)
        return toc_chapters

    if heuristic:
        logger.info("%s single heuristic chapter=%s", log_prefix, heuristic[0].title)
        return heuristic

    logger.warning(
        "[FALLBACK] materialId=%s reason=%s",
        material_id or "?",
        "TOC extraction returned no valid chapters; NCERT catalog not applied to uploads",
    )
    return []
