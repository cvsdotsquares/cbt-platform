from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question


class QuestionRepository:

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, question: Question):

        self.db.add(question)

        await self.db.commit()
        await self.db.refresh(question)

        return question

    async def get_by_id(
        self,
        question_id: str,
        tenant_id: str,
    ):

        result = await self.db.execute(
            select(Question).where(
                Question.id == question_id,
                Question.tenant_id == tenant_id,
            )
        )

        return result.scalar_one_or_none()

    async def get_all(
        self,
        tenant_id: str,
        question_type=None,
        difficulty=None,
        status=None,
        search=None,
        skip: int = 0,
        limit: int = 10,
    ):

        query = select(Question).where(
            Question.tenant_id == tenant_id
        )

        if question_type:
            query = query.where(
                Question.type == question_type
            )

        if difficulty:
            query = query.where(
                Question.difficulty == difficulty
            )

        if status:
            query = query.where(
                Question.status == status
            )

        if search:
            query = query.where(
                Question.title.ilike(f"%{search}%")
            )

        query = (
            query
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)

        return result.scalars().all()

    async def count(
        self,
        tenant_id: str,
        question_type=None,
        difficulty=None,
        status=None,
        search=None,
    ):

        query = (
            select(func.count())
            .select_from(Question)
            .where(
                Question.tenant_id == tenant_id
            )
        )

        if question_type:
            query = query.where(
                Question.type == question_type
            )

        if difficulty:
            query = query.where(
                Question.difficulty == difficulty
            )

        if status:
            query = query.where(
                Question.status == status
            )

        if search:
            query = query.where(
                Question.title.ilike(f"%{search}%")
            )

        result = await self.db.execute(query)

        return result.scalar_one()

    async def update(
        self,
        question: Question,
    ):

        await self.db.commit()
        await self.db.refresh(question)

        return question

    async def delete(
        self,
        question: Question,
    ):

        await self.db.delete(question)

        await self.db.commit()

        return True