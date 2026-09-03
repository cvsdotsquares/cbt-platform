from pydantic import BaseModel, ConfigDict
from typing import Any


class QuestionCreate(BaseModel):
    tenant_id: str
    user_id: str
    type: str
    difficulty: str | None = "MEDIUM"
    title: str | None = None
    content: dict[str, Any] | None = None
    options: dict[str, Any] | None = None
    correct_answer: dict[str, Any] | None = None
    marks: float | None = 1
    negative_marks: float | None = 0


class QuestionUpdate(BaseModel):
    type: str | None = None
    difficulty: str | None = None
    title: str | None = None
    content: dict[str, Any] | None = None
    options: dict[str, Any] | None = None
    correct_answer: dict[str, Any] | None = None
    marks: float | None = None
    negative_marks: float | None = None


class QuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tenant_id: str
    type: str
    difficulty: str | None = None
    title: str | None = None
    status: str | None = None