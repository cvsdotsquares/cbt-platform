"""NCERT chapter titles when PDF text cannot be parsed reliably."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExtractedTopic:
    title: str
    content: str
    order_index: int


@dataclass
class ExtractedChapter:
    number: int
    title: str
    content: str
    topics: list[ExtractedTopic]


NCERT_SYLLABUS_CATALOG: dict[int, dict[str, list[str]]] = {
    9: {
        "MATH": [
            "Number Systems",
            "Polynomials",
            "Coordinate Geometry",
            "Linear Equations",
            "Euclid's Geometry",
            "Lines and Angles",
            "Triangles",
            "Quadrilaterals",
            "Circles",
            "Heron's Formula",
            "Surface Areas and Volumes",
            "Statistics",
        ],
        "SCI": [
            "Matter in Our Surroundings",
            "Is Matter Around Us Pure",
            "Atoms and Molecules",
            "Structure of the Atom",
            "The Fundamental Unit of Life",
            "Tissues",
            "Motion",
            "Force and Laws of Motion",
            "Gravitation",
            "Work and Energy",
            "Sound",
            "Improvement in Food Resources",
        ],
        "ENG": [
            "The Fun They Had",
            "The Sound of Music",
            "The Little Girl",
            "A Truly Beautiful Mind",
            "The Snake and the Mirror",
            "My Childhood",
            "Reach for the Top",
            "Kathmandu",
            "If I Were You",
        ],
    },
    10: {
        "MATH": [
            "Real Numbers",
            "Polynomials",
            "Pair of Linear Equations in Two Variables",
            "Quadratic Equations",
            "Arithmetic Progressions",
            "Triangles",
            "Coordinate Geometry",
            "Introduction to Trigonometry",
            "Applications of Trigonometry",
            "Circles",
            "Constructions",
            "Areas Related to Circles",
            "Surface Areas and Volumes",
            "Statistics",
            "Probability",
        ],
        "SCI": [
            "Chemical Reactions and Equations",
            "Acids, Bases and Salts",
            "Metals and Non-metals",
            "Carbon and its Compounds",
            "Periodic Classification of Elements",
            "Life Processes",
            "Control and Coordination",
            "How do Organisms Reproduce",
            "Heredity and Evolution",
            "Light – Reflection and Refraction",
            "Human Eye and Colourful World",
            "Electricity",
            "Magnetic Effects of Electric Current",
            "Sources of Energy",
            "Our Environment",
            "Sustainable Management of Natural Resources",
        ],
        "ENG": [
            "A Letter to God",
            "Nelson Mandela",
            "Two Stories about Flying",
            "From the Diary of Anne Frank",
            "Glimpses of India",
            "Mijbil the Otter",
            "Madam Rides the Bus",
            "The Sermon at Benares",
            "The Proposal",
        ],
    },
    12: {
        # NCERT Flamingo (fallback only when PDF TOC cannot be read)
        "ENG": [
            "The Last Lesson",
            "Lost Spring",
            "Deep Water",
            "The Rattrap",
            "Indigo",
            "Poets and Pancakes",
            "The Interview",
            "Going Places",
        ],
    },
}


_CATALOG_CODE_ALIASES: dict[str, str] = {
    "ENGLISH": "ENG",
    "ENG": "ENG",
    "MATHEMATICS": "MATH",
    "MATHS": "MATH",
    "MATH": "MATH",
    "SCIENCE": "SCI",
    "SCI": "SCI",
    "SOCIAL SCIENCE": "SST",
    "SOCIAL STUDIES": "SST",
    "SOCIAL": "SST",
    "SST": "SST",
}


def normalize_catalog_subject_code(subject_code: str | None) -> str:
    code = (subject_code or "").upper().strip()
    if not code:
        return ""
    return _CATALOG_CODE_ALIASES.get(code, code)


def catalog_chapter_title(class_level: int, subject_code: str, chapter_number: int) -> str | None:
    code = normalize_catalog_subject_code(subject_code)
    titles = NCERT_SYLLABUS_CATALOG.get(class_level, {}).get(code)
    if not titles or chapter_number < 1 or chapter_number > len(titles):
        return None
    return titles[chapter_number - 1]


def infer_ncert_subject_code(subject_code: str | None, subject_name: str | None) -> str:
    raw = (subject_code or "").upper().strip()
    if raw:
        return normalize_catalog_subject_code(raw)
    name = (subject_name or "").lower()
    if "english" in name:
        return "ENG"
    if "mathematics" in name or "maths" in name:
        return "MATH"
    if "social" in name or "history" in name or "geography" in name or "civics" in name:
        return "SST"
    if "science" in name or "physics" in name or "chemistry" in name or "biology" in name:
        return "SCI"
    return ""


def get_ncert_fallback_chapters(class_level: int, subject_code: str) -> list[ExtractedChapter]:
    code = normalize_catalog_subject_code(subject_code)
    titles = NCERT_SYLLABUS_CATALOG.get(class_level, {}).get(code)
    if not titles:
        return []
    return [
        ExtractedChapter(
            number=i + 1,
            title=title,
            content="",
            topics=[],
        )
        for i, title in enumerate(titles)
    ]


def get_ncert_chapters_for_subject(
    class_level: int | None,
    subject_code: str | None,
    subject_name: str | None,
) -> list[ExtractedChapter]:
    if class_level is None:
        return []
    codes: list[str] = []
    inferred = infer_ncert_subject_code(subject_code, subject_name)
    if inferred:
        codes.append(inferred)
    raw = normalize_catalog_subject_code(subject_code)
    if raw and raw not in codes:
        codes.append(raw)
    name_inferred = infer_ncert_subject_code(None, subject_name)
    if name_inferred and name_inferred not in codes:
        codes.append(name_inferred)
    for code in codes:
        chapters = get_ncert_fallback_chapters(class_level, code)
        if chapters:
            return chapters
    return []
