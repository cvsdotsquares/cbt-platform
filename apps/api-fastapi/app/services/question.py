from fastapi import HTTPException

from app.models.question import Question
from app.repositories.question import QuestionRepository


class QuestionService:

    def __init__(self, repository: QuestionRepository):
        self.repository = repository

    async def create_question(
        self,
        tenant_id: str,
        user_id: str,
        data: dict,
    ):
        question = Question(
            tenant_id=tenant_id,
            type=data["type"],
            difficulty=data.get("difficulty"),
            title=data.get("title"),
            created_by_id=user_id,
        )

        return await self.repository.create(question)

    async def approve_question(
        self,
        question_id: str,
        tenant_id: str,
    ):
        question = await self.repository.get_by_id(
            question_id,
            tenant_id,
        )

        if not question:
            raise HTTPException(
                status_code=404,
                detail="Question not found",
            )

        question.status = "APPROVED"

        return await self.repository.update(question)

    async def get_question(
        self,
        question_id: str,
        tenant_id: str,
    ):
        question = await self.repository.get_by_id(
            question_id,
            tenant_id,
        )

        if not question:
            raise HTTPException(
                status_code=404,
                detail="Question not found",
            )

        return question

    async def get_questions(
        self,
        tenant_id: str,
        question_type=None,
        difficulty=None,
        status=None,
        search=None,
        page: int = 1,
        limit: int = 10,
    ):
        if page < 1:
            page = 1

        if limit < 1:
            limit = 10

        skip = (page - 1) * limit

        questions = await self.repository.get_all(
            tenant_id=tenant_id,
            question_type=question_type,
            difficulty=difficulty,
            status=status,
            search=search,
            skip=skip,
            limit=limit,
        )

        total = await self.repository.count(
            tenant_id=tenant_id,
            question_type=question_type,
            difficulty=difficulty,
            status=status,
            search=search,
        )

        return {
            "items": questions,
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": (
                (total + limit - 1) // limit
                if total > 0
                else 0
            ),
        }

    async def update_question(
        self,
        question_id: str,
        tenant_id: str,
        data: dict,
    ):
        question = await self.repository.get_by_id(
            question_id,
            tenant_id,
        )

        if not question:
            raise HTTPException(
                status_code=404,
                detail="Question not found",
            )

        for key, value in data.items():

            if value is not None and hasattr(question, key):

                setattr(
                    question,
                    key,
                    value,
                )

        return await self.repository.update(question)

    async def delete_question(
        self,
        question_id: str,
        tenant_id: str,
    ):
        question = await self.repository.get_by_id(
            question_id,
            tenant_id,
        )

        if not question:
            raise HTTPException(
                status_code=404,
                detail="Question not found",
            )

        await self.repository.delete(question)

        return {
            "deleted": True
        }