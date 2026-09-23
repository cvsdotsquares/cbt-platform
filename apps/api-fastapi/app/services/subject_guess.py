"""Guess NCERT subject from upload file names / titles."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.curriculum import Subject

# (regex on file/title, preferred subject name/code tokens)
_SUBJECT_PATTERNS: list[tuple[re.Pattern[str], tuple[str, ...]]] = [
    (re.compile(r"\benglish\b|\beng(?:lish)?\b", re.I), ("english", "eng")),
    (re.compile(r"\bmathematics\b|\bmaths?\b|\bmath\b", re.I), ("mathematics", "maths", "math")),
    (re.compile(r"\bsocial\s*science\b|\bsst\b|\bhistory\b|\bgeography\b|\bcivics\b|\beconomics\b", re.I), ("social", "sst", "history", "geography")),
    (re.compile(r"\bphysics\b|\bphy\b", re.I), ("physics", "phy")),
    (re.compile(r"\bchemistry\b|\bchem\b", re.I), ("chemistry", "chem")),
    (re.compile(r"\bbiology\b|\bbio\b", re.I), ("biology", "bio")),
    (re.compile(r"\bscience\b|\bsci\b", re.I), ("science", "sci")),
    (re.compile(r"\bhindi\b", re.I), ("hindi", "hin")),
    (re.compile(r"\bsanskrit\b", re.I), ("sanskrit", "san")),
]


def _subject_tokens(subject: "Subject") -> set[str]:
    tokens = {subject.name.lower().strip()}
    if subject.code:
        tokens.add(subject.code.lower().strip())
    return tokens


def guess_subject_id(
    file_name: str,
    title: str,
    subjects: list["Subject"],
    fallback_subject_id: str | None = None,
) -> str | None:
    if not subjects:
        return fallback_subject_id

    haystack = f"{file_name} {title}".lower()
    for pattern, hints in _SUBJECT_PATTERNS:
        if not pattern.search(haystack):
            continue
        for subject in subjects:
            tokens = _subject_tokens(subject)
            if tokens & set(hints):
                return subject.id
            for hint in hints:
                if any(hint in t or t in hint for t in tokens):
                    return subject.id

    return fallback_subject_id
