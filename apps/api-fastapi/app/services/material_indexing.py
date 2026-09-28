"""Background PDF/text indexing for study materials."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.material import StudyMaterial
from app.services.material_storage import chunk_material_text, extract_material_text

logger = logging.getLogger(__name__)

CHUNK_INSERT_BATCH = 250
MAX_CONCURRENT_INDEX_JOBS = int(os.getenv("MATERIAL_INDEX_CONCURRENCY", "2"))
_index_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INDEX_JOBS)
_active_jobs: set[str] = set()
_jobs_lock = asyncio.Lock()
_cancelled_ids: set[str] = set()


def request_material_index_cancel(material_id: str) -> None:
    """Stop a queued/running index job so deletes and re-uploads are not blocked."""
    _cancelled_ids.add(material_id)


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
    await db.commit()
    rows = _chunk_insert_rows(material, chunks, now)
    for start in range(0, len(rows), CHUNK_INSERT_BATCH):
        if material.id in _cancelled_ids:
            _cancelled_ids.discard(material.id)
            return
        batch = rows[start : start + CHUNK_INSERT_BATCH]
        await _insert_chunks(db, batch)
        await db.commit()
    material.chunk_count = len(chunks)
    material.status = "READY"
    material.error_message = None
    material.indexed_at = now
    material.updated_at = now


async def run_material_index_job(material_id: str, tenant_id: str) -> None:
    async with _jobs_lock:
        if material_id in _active_jobs:
            return
        _active_jobs.add(material_id)

    started = time.perf_counter()
    try:
        async with _index_semaphore:
            await _run_material_index_job_inner(material_id, tenant_id, started)
    finally:
        async with _jobs_lock:
            _active_jobs.discard(material_id)


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
            extracted = await asyncio.to_thread(
                extract_material_text, file_url, mime_type, file_name
            )
            if material_id in _cancelled_ids:
                _cancelled_ids.discard(material_id)
                return
            chunks = chunk_material_text(extracted)
            if not chunks:
                raise ValueError("No readable text found in material")
        except Exception as exc:
            await _mark_material_failed(material_id, exc)
            logger.warning("Material indexing failed for %s: %s", material_id, exc)
            return

        chunk_count = len(chunks)
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
                return
            await _persist_material_chunks(db, material, chunks)
            await db.commit()
            _cancelled_ids.discard(material_id)

        logger.info(
            "Indexing finished: material=%s chunks=%s elapsed=%.1fs",
            material_id,
            chunk_count,
            time.perf_counter() - started,
        )
    except Exception:
        logger.exception("Unexpected material indexing error for %s", material_id)


def schedule_material_index(background_tasks, material_id: str, tenant_id: str) -> None:
    async def _start() -> None:
        await run_material_index_job(material_id, tenant_id)

    # BackgroundTasks run after the DB session commits (safe). create_task is for startup/watchdog.
    if background_tasks is not None:
        background_tasks.add_task(_start)
    else:
        asyncio.create_task(_start())


async def resume_stuck_indexing_jobs() -> None:
    """Re-queue INDEXING materials whose background job was lost (e.g. uvicorn --reload)."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(StudyMaterial.id, StudyMaterial.tenant_id).where(
                StudyMaterial.status.in_(("INDEXING", "PENDING"))
            )
        )
        pending = result.all()

    queued = 0
    for material_id, tenant_id in pending:
        mid = str(material_id)
        if mid in _active_jobs or mid in _cancelled_ids:
            continue
        schedule_material_index(None, mid, str(tenant_id))
        queued += 1

    if queued:
        logger.warning("Queued %s material indexing job(s) (status=INDEXING)", queued)


async def indexing_watchdog_loop() -> None:
    while True:
        await asyncio.sleep(30)
        try:
            await resume_stuck_indexing_jobs()
        except Exception:
            logger.exception("Material indexing watchdog failed")
