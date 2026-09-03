from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import (
    get_current_tenant,
    get_current_user,
    require_permission,
)
from app.models.question import Question, QuestionStatus, QuestionVersion
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter(
    prefix="/questions",
    tags=["Questions"],
)


class QuestionVersionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version_number: int = 1
    content: Any = ""
    options: Optional[Any] = None
    correct_answer: Optional[Any] = None
    marks: float = 1.0
    negative_marks: float = 0.0
    explanation: Optional[str] = None


class QuestionCreate(BaseModel):
    title: Optional[str] = None
    type: str = "MCQ"
    difficulty: str = "MEDIUM"
    topic_id: Optional[UUID] = None
    description: Optional[str] = None
    content: Optional[Any] = ""
    options: Optional[Any] = None
    correct_answer: Optional[Any] = None
    marks: float = 1.0
    negative_marks: float = 0.0
    explanation: Optional[str] = None


class QuestionUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    difficulty: Optional[str] = None
    topic_id: Optional[UUID] = None
    description: Optional[str] = None
    status: Optional[str] = None


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    type: str
    difficulty: str
    title: Optional[str] = None
    description: Optional[str] = None
    status: str
    topic_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    versions: List[QuestionVersionSchema] = []


@router.post("", response_model=QuestionOut, status_code=status.HTTP_201_CREATED)
async def create_question(
    data: QuestionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
):
    tenant_id = current_tenant.id if current_tenant else current_user.tenant_id
    q_id = uuid.uuid4()
    v_id = uuid.uuid4()

    new_q = Question(
        id=q_id,
        tenant_id=tenant_id,
        type=data.type,
        difficulty=data.difficulty,
        topic_id=data.topic_id,
        title=data.title,
        description=data.description,
        status=QuestionStatus.DRAFT,
        created_by_id=current_user.id,
        current_version_id=v_id,
    )
    db.add(new_q)

    new_v = QuestionVersion(
        id=v_id,
        question_id=q_id,
        version_number=1,
        content=data.content or data.title or "",
        options=data.options,
        correct_answer=data.correct_answer,
        marks=data.marks,
        negative_marks=data.negative_marks,
        explanation=data.explanation,
    )
    db.add(new_v)

    await db.commit()
    await db.refresh(new_q)
    return new_q


@router.get("", response_model=List[QuestionOut])
async def list_questions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
    topic_id: Optional[UUID] = None,
    status: Optional[str] = None,
):
    tenant_id = current_tenant.id if current_tenant else current_user.tenant_id
    query = (
        select(Question)
        .options(selectinload(Question.versions))
        .where(Question.tenant_id == tenant_id)
        .order_by(Question.created_at.desc())
    )
    if topic_id:
        query = query.where(Question.topic_id == topic_id)
    if status:
        query = query.where(Question.status == status)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{question_id}", response_model=QuestionOut)
async def get_question(
    question_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
):
    tenant_id = current_tenant.id if current_tenant else current_user.tenant_id
    result = await db.execute(
        select(Question)
        .options(selectinload(Question.versions))
        .where(Question.id == question_id, Question.tenant_id == tenant_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    return q


@router.put("/{question_id}", response_model=QuestionOut)
async def update_question(
    question_id: UUID,
    data: QuestionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
):
    tenant_id = current_tenant.id if current_tenant else current_user.tenant_id
    result = await db.execute(
        select(Question)
        .options(selectinload(Question.versions))
        .where(Question.id == question_id, Question.tenant_id == tenant_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(q, k, v)

    await db.commit()
    await db.refresh(q)
    return q


@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    current_tenant: Optional[Tenant] = Depends(get_current_tenant),
):
    tenant_id = current_tenant.id if current_tenant else current_user.tenant_id
    result = await db.execute(
        select(Question).where(Question.id == question_id, Question.tenant_id == tenant_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    await db.delete(q)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)