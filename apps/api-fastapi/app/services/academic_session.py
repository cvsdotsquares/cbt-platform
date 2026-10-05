"""Academic session matching (align with web `sessionsMatch`)."""


def study_material_session_sql(column: str = "sm.academic_session") -> str:
    """Session filter for batch syllabus.

    Institute-wide full-book uploads (no section/batch) apply to every batch of that class.
    Section-scoped uploads must match the batch academic year when set.
    """
    return (
        f"AND ("
        f"(sm.is_full_book IS TRUE AND sm.batch_id IS NULL) "
        f"OR TRIM(COALESCE({column}, '')) = '' "
        f"OR {column} = :academic_session"
        f")"
    )
