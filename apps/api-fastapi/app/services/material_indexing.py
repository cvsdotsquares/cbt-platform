"""Background PDF/text indexing for study materials."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.material import StudyMaterial
from app.services.material_storage import chunk_material_text, extract_material_text_for_indexing
from app.services.syllabus_sync import sync_material_syllabus_from_text

logger = logging.getLogger(__name__)

CHUNK_INSERT_BATCH = 250
MAX_CONCURRENT_INDEX_JOBS = int(os.getenv("MATERIAL_INDEX_CONCURRENCY", "1"))
EXTRACT_TIMEOUT_SEC = float(os.getenv("MATERIAL_INDEX_EXTRACT_TIMEOUT_SEC", "600"))
INDEX_EXTRACT_TIMEOUT_SEC = float(os.getenv("MATERIAL_INDEX_FAST_EXTRACT_TIMEOUT_SEC", "45"))
INDEX_MAX_CHUNKS = int(os.getenv("MATERIAL_INDEX_MAX_CHUNKS", "40"))
STALE_INDEXING_SEC = float(os.getenv("MATERIAL_INDEX_STALE_SEC", "900"))
# If status is INDEXING but no in-memory job runs (e.g. uvicorn --reload), re-queue after this grace.
LOST_INDEX_JOB_GRACE_SEC = float(os.getenv("MATERIAL_INDEX_LOST_JOB_GRACE_SEC", "12"))
# Cap PDF pages during indexing (0 = all pages). ~36 pages targets 15–30s with PyMuPDF.
_INDEX_PDF_MAX_PAGES_RAW = os.getenv("MATERIAL_INDEX_MAX_PDF_PAGES", "36").strip()


def _indexing_pdf_max_pages() -> int | None:
    if not _INDEX_PDF_MAX_PAGES_RAW or _INDEX_PDF_MAX_PAGES_RAW == "0":
        return None
    return int(_INDEX_PDF_MAX_PAGES_RAW)
_index_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INDEX_JOBS)
_active_jobs: set[str] = set()
_job_started_at: dict[str, float] = {}
_job_tenant: dict[str, str] = {}
_jobs_lock = asyncio.Lock()
_cancelled_ids: set[str] = set()


def request_material_index_cancel(material_id: str) -> None:
    """Stop a queued/running index job so deletes and re-uploads are not blocked."""
    _cancelled_ids.add(material_id)


async def prepare_material_reindex(material_id: str) -> None:
    """Allow a new index run (re-index) even if a prior job was stuck or overlapping."""
    _cancelled_ids.discard(material_id)
    await wait_for_material_index_idle([material_id], timeout_sec=45.0)
    async with _jobs_lock:
        _active_jobs.discard(material_id)


async def wait_for_material_index_idle(
    material_ids: set[str] | list[str],
    *,
    timeout_sec: float = 25.0,
) -> bool:
    """Wait until background index jobs for these materials finish (or timeout)."""
    pending = {str(m) for m in material_ids}
    if not pending:
        return True
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        async with _jobs_lock:
            if not pending & _active_jobs:
                return True
        await asyncio.sleep(0.2)
    async with _jobs_lock:
        return not bool(pending & _active_jobs)


def _chunk_insert_rows(
    material: StudyMaterial,
    chunks: list[str],
    now: datetime,
) -> list[dict]:
    return [
        {
            "id": str(uuid.uuid4()),
            "material_id": material.id,
            "content": content,
            "chunk_index": index,
            "academic_class_id": material.academic_class_id,
            "subject_id": material.subject_id,
            "chapter_id": material.chapter_id,
            "topic_id": material.topic_id,
            "created_at": now,
        }
        for index, content in enumerate(chunks)
    ]


async def _insert_chunks(db: AsyncSession, rows: list[dict]) -> None:
    if not rows:
        return
    stmt = text(
        """
        INSERT INTO document_chunks
          (id, material_id, content, chunk_index, academic_class_id, subject_id,
           chapter_id, topic_id, created_at)
        VALUES
          (:id, :material_id, :content, :chunk_index, :academic_class_id, :subject_id,
           :chapter_id, :topic_id, :created_at)
        """
    )
    for start in range(0, len(rows), CHUNK_INSERT_BATCH):
        batch = rows[start : start + CHUNK_INSERT_BATCH]
        await db.execute(stmt, batch)


async def _abort_indexing(material_id: str, *, retry: bool = True, message: str | None = None) -> None:
    """Clear INDEXING when a background job exits without finishing (cancel, lost task, hang recovery)."""
    async with AsyncSessionLocal() as err_db:
        err_result = await err_db.execute(
            select(StudyMaterial).where(StudyMaterial.id == material_id)
        )
        material = err_result.scalar_one_or_none()
        if not material or material.status != "INDEXING":
            return
        now = datetime.now(timezone.utc)
        if retry:
            material.status = "PENDING"
            material.error_message = None
        else:
            material.status = "FAILED"
            material.error_message = (message or "Indexing interrupted")[:1000]
        material.updated_at = now
        await err_db.commit()


async def _mark_material_failed(material_id: str, exc: Exception) -> None:
    async with AsyncSessionLocal() as err_db:
        err_result = await err_db.execute(
            select(StudyMaterial).where(StudyMaterial.id == material_id)
        )
        failed = err_result.scalar_one_or_none()
        if failed:
            failed.status = "FAILED"
            failed.error_message = str(exc)[:1000]
            failed.updated_at = datetime.now(timezone.utc)
            await err_db.commit()


async def _persist_material_chunks(
    db: AsyncSession, material: StudyMaterial, chunks: list[str]
) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        text("DELETE FROM document_chunks WHERE material_id = :material_id"),
        {"material_id": material.id},
    )
    rows = _chunk_insert_rows(material, chunks, now)
    for start in range(0, len(rows), CHUNK_INSERT_BATCH):
        if material.id in _cancelled_ids:
            _cancelled_ids.discard(material.id)
            await db.commit()
            await _abort_indexing(str(material.id), retry=True)
            return
        batch = rows[start : start + CHUNK_INSERT_BATCH]
        await _insert_chunks(db, batch)
    material.chunk_count = len(chunks)
    material.status = "READY"
    material.error_message = None
    material.indexed_at = now
    material.updated_at = now


async def run_material_index_job(material_id: str, tenant_id: str, *, force: bool = False) -> None:
    if force:
        _cancelled_ids.discard(material_id)
    async with _jobs_lock:
        if material_id in _active_jobs and not force:
            logger.info("Index job already running for material %s", material_id)
            return
        _active_jobs.add(material_id)

    started = time.perf_counter()
    try:
        async with _jobs_lock:
            _job_started_at[material_id] = time.monotonic()
            _job_tenant[material_id] = tenant_id
        async with _index_semaphore:
            await _run_material_index_job_inner(material_id, tenant_id, started)
    finally:
        async with _jobs_lock:
            _active_jobs.discard(material_id)
            _job_started_at.pop(material_id, None)
            _job_tenant.pop(material_id, None)


async def _run_material_index_job_inner(material_id: str, tenant_id: str, started: float) -> None:
    if material_id in _cancelled_ids:
        _cancelled_ids.discard(material_id)
        return
    try:
        file_url: str
        mime_type: str
        file_name: str
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(StudyMaterial).where(
                    StudyMaterial.id == material_id,
                    StudyMaterial.tenant_id == tenant_id,
                )
            )
            material = result.scalar_one_or_none()
            if not material:
                return

            file_url = material.file_url
            mime_type = material.mime_type
            file_name = material.file_name
            file_size = material.file_size
            now = datetime.now(timezone.utc)
            material.status = "INDEXING"
            material.updated_at = now
            await db.commit()

        logger.info(
            "Indexing started: material=%s file=%s size=%s",
            material_id,
            file_name,
            file_size,
        )

        try:
            extract_started = time.perf_counter()
            pdf_max_pages = _indexing_pdf_max_pages()
            extracted, syllabus_source = await asyncio.wait_for(
                asyncio.to_thread(
                    extract_material_text_for_indexing,
                    file_url,
                    mime_type,
                    file_name,
                    body_max_pages=pdf_max_pages,
                ),
                timeout=INDEX_EXTRACT_TIMEOUT_SEC,
            )
            logger.info(
                "PDF/text extract done: material=%s body_chars=%s toc_chars=%s elapsed=%.1fs",
                material_id,
                len(extracted or ""),
                len(syllabus_source or ""),
                time.perf_counter() - extract_started,
            )
            if material_id in _cancelled_ids:
                _cancelled_ids.discard(material_id)
                await _abort_indexing(material_id, retry=True)
                return
            chunk_started = time.perf_counter()
            chunks = await asyncio.to_thread(chunk_material_text, extracted, 3600, 280)
            if len(chunks) > INDEX_MAX_CHUNKS:
                chunks = chunks[:INDEX_MAX_CHUNKS]
            logger.info(
                "Text chunked: material=%s chunks=%s elapsed=%.1fs",
                material_id,
                len(chunks),
                time.perf_counter() - chunk_started,
            )
            if not chunks:
                raise ValueError("No readable text found in material")
        except asyncio.TimeoutError:
            await _mark_material_failed(
                material_id,
                ValueError(
                    f"PDF text extraction timed out after {int(INDEX_EXTRACT_TIMEOUT_SEC)}s. "
                    "Try Re-index or a smaller PDF."
                ),
            )
            logger.warning(
                "Material indexing timed out during extract for %s (file=%s)",
                material_id,
                file_name,
            )
            return
        except Exception as exc:
            await _mark_material_failed(material_id, exc)
            logger.warning("Material indexing failed for %s: %s", material_id, exc)
            return

        chunk_count = len(chunks)
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(StudyMaterial).where(
                        StudyMaterial.id == material_id,
                        StudyMaterial.tenant_id == tenant_id,
                    )
                )
                material = result.scalar_one_or_none()
                if not material or material_id in _cancelled_ids:
                    _cancelled_ids.discard(material_id)
                    await _abort_indexing(material_id, retry=True)
                    return
                await sync_material_syllabus_from_text(
                    db,
                    material,
                    extracted,
                    syllabus_source_text=syllabus_source,
                )
                await db.flush()
                await _persist_material_chunks(db, material, chunks)
                await db.commit()
                _cancelled_ids.discard(material_id)
        except Exception as exc:
            await _mark_material_failed(material_id, exc)
            logger.warning(
                "Material syllabus/chunk persist failed for %s: %s",
                material_id,
                exc,
            )
            return

        logger.info(
            "Indexing finished: material=%s chunks=%s elapsed=%.1fs",
            material_id,
            chunk_count,
            time.perf_counter() - started,
        )
    except Exception as exc:
        await _mark_material_failed(material_id, exc)
        logger.exception("Unexpected material indexing error for %s", material_id)


def schedule_material_index(
    background_tasks,
    material_id: str,
    tenant_id: str,
    *,
    force: bool = False,
) -> None:
    async def _start() -> None:
        await run_material_index_job(material_id, tenant_id, force=force)

    # Prefer create_task so indexing is not dropped if the client disconnects early.
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_start())
    except RuntimeError:
        if background_tasks is not None:
            background_tasks.add_task(_start)
        else:
            asyncio.create_task(_start())


def _syllabus_titles_look_corrupt(titles: list[str]) -> bool:
    if not titles:
        return True
    garbage = re.compile(
        r"find their own answers|^\(\s*[a-divx]+\s*\)$|^\d+\.?\s*$|^[sy]\s*=|sec\s*a\s*[-–]",
        re.I,
    )
    for raw in titles:
        t = (raw or "").strip()
        if not t or len(t) <= 3 or garbage.search(t):
            return True
    return False


async def resync_full_book_syllabi_from_text() -> int:
    """Rebuild chapter rows when stored titles look like answer-key junk."""
    from app.models.curriculum import Chapter
    from app.services.syllabus_sync import sync_material_syllabus_from_text

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(StudyMaterial).where(
                StudyMaterial.is_full_book.is_(True),
                StudyMaterial.status == "READY",
                StudyMaterial.book_id.isnot(None),
            )
        )
        materials = list(result.scalars().all())

    fixed = 0
    for material in materials:
        try:
            async with AsyncSessionLocal() as db:
                mat = await db.get(StudyMaterial, material.id)
                if not mat or not mat.book_id:
                    continue
                ch_result = await db.execute(
                    select(Chapter.title).where(Chapter.book_id == mat.book_id)
                )
                titles = [str(row[0]) for row in ch_result.all()]
                if not _syllabus_titles_look_corrupt(titles):
                    continue
                text = await asyncio.to_thread(
                    extract_material_text,
                    mat.file_url,
                    mat.mime_type,
                    mat.file_name,
                )
                await sync_material_syllabus_from_text(db, mat, text)
                await db.commit()
                fixed += 1
        except Exception:
            logger.exception("Full-book syllabus resync failed for %s", material.id)
    if fixed:
        logger.warning("Resynced syllabus chapters for %s full-book material(s)", fixed)
    return fixed


async def _release_hung_active_jobs() -> int:
    """Drop jobs that exceeded extract timeout + buffer (stuck thread pool work)."""
    now = time.monotonic()
    released = 0
    async with _jobs_lock:
        hung = [
            mid
            for mid in _active_jobs
            if now - _job_started_at.get(mid, now) > EXTRACT_TIMEOUT_SEC + 120
        ]
    for mid in hung:
        tenant = _job_tenant.get(mid)
        logger.error(
            "Releasing hung material index job material=%s (over %ss)",
            mid,
            int(EXTRACT_TIMEOUT_SEC + 120),
        )
        async with _jobs_lock:
            _active_jobs.discard(mid)
            _job_started_at.pop(mid, None)
            _job_tenant.pop(mid, None)
        await _abort_indexing(mid, retry=True)
        if tenant:
            schedule_material_index(None, mid, tenant, force=True)
        released += 1
    return released


async def resume_stuck_indexing_jobs() -> None:
    """Re-queue INDEXING/PENDING materials whose background job was lost (e.g. uvicorn --reload)."""
    now_ts = datetime.now(timezone.utc).timestamp()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(
                StudyMaterial.id,
                StudyMaterial.tenant_id,
                StudyMaterial.status,
                StudyMaterial.updated_at,
            ).where(StudyMaterial.status.in_(("INDEXING", "PENDING")))
        )
        pending = result.all()

    queued = 0
    for material_id, tenant_id, status, updated_at in pending:
        mid = str(material_id)
        if mid in _cancelled_ids:
            continue
        if mid in _active_jobs:
            continue
        updated_ts = updated_at.timestamp()
        if status == "INDEXING":
            age_sec = now_ts - updated_ts
            if age_sec < LOST_INDEX_JOB_GRACE_SEC:
                continue
            if age_sec > STALE_INDEXING_SEC:
                logger.warning(
                    "Re-queueing long-stuck INDEXING material=%s (age=%.0fs)",
                    mid,
                    age_sec,
                )
        schedule_material_index(None, mid, str(tenant_id), force=True)
        queued += 1

    if queued:
        logger.warning("Queued %s material indexing job(s) (stuck INDEXING/PENDING)", queued)


async def indexing_watchdog_loop() -> None:
    while True:
        await asyncio.sleep(15)
        try:
            await _release_hung_active_jobs()
            await resume_stuck_indexing_jobs()
        except Exception:
            logger.exception("Material indexing watchdog failed")
