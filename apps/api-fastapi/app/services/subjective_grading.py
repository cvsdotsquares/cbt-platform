"""Keyword-based auto-grading for subjective and case-study answers."""

from __future__ import annotations

import re
from typing import Any

from app.services.candidate_context import parse_json

_STOPWORDS = frozenset(
    {
        "about", "after", "also", "among", "and", "are", "because", "been", "being",
        "between", "both", "but", "can", "could", "describe", "does", "each", "explain",
        "for", "from", "have", "help", "here", "how", "into", "its", "like", "more",
        "most", "must", "not", "only", "other", "should", "such", "than", "that",
        "the", "their", "them", "then", "there", "these", "they", "this", "those",
        "through", "using", "very", "what", "when", "where", "which", "while", "will",
        "with", "would", "your", "answer", "question", "marks", "award", "relevant",
        "clear", "clearly", "accuracy", "reasoning", "concept", "concepts",
    }
)

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9\-']{2,}", re.IGNORECASE)


def _normalize_correct(correct: Any) -> dict[str, Any]:
    if correct is None:
        return {}
    if isinstance(correct, str):
        parsed = parse_json(correct)
        return parsed if isinstance(parsed, dict) else {"value": correct}
    if isinstance(correct, dict):
        return correct
    return {"value": correct}


def extract_keywords(correct: Any, *, max_terms: int = 10) -> list[str]:
    data = _normalize_correct(correct)
    explicit = data.get("keywords") or data.get("keyWords") or data.get("importantKeywords")
    if isinstance(explicit, list):
        terms = [str(k).strip() for k in explicit if str(k).strip()]
        if terms:
            return terms[:max_terms]
    if isinstance(explicit, str) and explicit.strip():
        parts = re.split(r"[,;\n|]+", explicit)
        terms = [p.strip() for p in parts if p.strip()]
        if terms:
            return terms[:max_terms]

    reference = data.get("value")
    ref_text = ""
    if isinstance(reference, str):
        ref_text = reference
    elif reference is not None:
        ref_text = str(reference)

    rubric = data.get("rubric")
    rubric_text = rubric if isinstance(rubric, str) else ""

    keywords: list[str] = []
    seen: set[str] = set()

    def add_term(term: str) -> None:
        cleaned = term.strip().lower()
        if len(cleaned) < 3 or cleaned in _STOPWORDS or cleaned in seen:
            return
        seen.add(cleaned)
        keywords.append(term.strip())

    for source in (ref_text, rubric_text):
        for match in _TOKEN_RE.finditer(source.lower()):
            token = match.group(0)
            if token in _STOPWORDS or len(token) < 4:
                continue
            add_term(token)
            if len(keywords) >= max_terms:
                return keywords[:max_terms]

    # Multi-word phrases from reference (simple bigrams of significant tokens)
    ref_tokens = [
        m.group(0).lower()
        for m in _TOKEN_RE.finditer(ref_text.lower())
        if len(m.group(0)) >= 4 and m.group(0).lower() not in _STOPWORDS
    ]
    for i in range(len(ref_tokens) - 1):
        phrase = f"{ref_tokens[i]} {ref_tokens[i + 1]}"
        add_term(phrase)
        if len(keywords) >= max_terms:
            break

    return keywords[:max_terms]


def _term_present(haystack: str, term: str) -> bool:
    t = term.lower().strip()
    if not t:
        return False
    if t in haystack:
        return True
    if " " not in t:
        return re.search(rf"\b{re.escape(t)}\b", haystack) is not None
    return t in haystack


def grade_subjective_answer(
    answer_text: str,
    correct: Any,
    max_marks: float,
) -> tuple[bool | None, float | None]:
    """
    Score subjective answers by matching important keywords from the model answer / rubric.
    Returns (is_correct, marks_awarded). is_correct is True when all keywords match.
    """
    if max_marks <= 0:
        return None, 0.0

    text = (answer_text or "").strip()
    if not text:
        return None, 0.0

    keywords = extract_keywords(correct)
    if not keywords:
        return None, None

    haystack = text.lower()
    matched = sum(1 for kw in keywords if _term_present(haystack, kw))
    ratio = matched / len(keywords)
    marks = round(max_marks * ratio, 2)
    is_correct = matched == len(keywords)
    return is_correct, marks
