# app/schemas/exam.py
from datetime import datetime
from typing import List, Optional, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# BASE SCHEMAS
# ============================================================

class ExamBase(BaseModel):
    """Base exam schema."""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    duration_minutes: int = Field(..., gt=0)
    passing_score: int = Field(70, ge=0, le=100)
    max_attempts: int = Field(1, ge=1)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class ExamCreate(ExamBase):
    """Schema for creating an exam."""
    status: Optional[str] = "DRAFT"
    created_by_id: Optional[UUID] = None
    code: Optional[str] = None 


class ExamUpdate(BaseModel):
    """Schema for updating an exam."""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, gt=0)
    passing_score: Optional[int] = Field(None, ge=0, le=100)
    max_attempts: Optional[int] = Field(None, ge=1)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None


# ============================================================
# RESPONSE SCHEMAS
# ============================================================

class ExamResponse(BaseModel):
    """Exam response schema."""
    id: UUID
    title: str
    description: Optional[str] = None
    duration_minutes: Optional[int] = None  # <--- Made Optional
    passing_score: Optional[int] = None     # <--- Made Optional
    max_attempts: Optional[int] = None      # <--- Made Optional
    status: str
    is_active: Optional[bool] = None        # <--- Made Optional
    starts_at: Optional[datetime] = None    # <--- Made Optional
    ends_at: Optional[datetime] = None      # <--- Made Optional
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None

    class Config:
        from_attributes = True


class ExamSectionResponse(BaseModel):
    """Exam section response schema."""
    id: UUID
    exam_id: UUID
    title: str
    description: Optional[str]
    order: int
    created_at: datetime
    updated_at: Optional[datetime]
    questions_count: Optional[int] = 0

    class Config:
        from_attributes = True


class QuestionResponse(BaseModel):
    """Question response schema."""
    id: UUID
    title: str
    content: str
    difficulty: int
    status: str
    topic_id: Optional[UUID]
    created_by_id: Optional[UUID]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ExamQuestionResponse(BaseModel):
    """Exam question response schema."""
    exam_id: UUID
    question_id: UUID
    section_id: Optional[UUID]
    order: int
    points: int
    question: Optional[QuestionResponse] = None

    class Config:
        from_attributes = True


class ExamDetailResponse(BaseModel):
    """Detailed exam response with sections and questions."""
    id: UUID
    title: str
    description: Optional[str]
    duration_minutes: int
    passing_score: int
    max_attempts: int
    status: str
    is_active: bool
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]
    created_by_id: Optional[UUID]
    sections: List[ExamSectionResponse] = []
    registrations_count: int = 0
    questions_count: int = 0
    total_questions: Optional[int] = 0

    class Config:
        from_attributes = True


# ============================================================
# SECTION SCHEMAS
# ============================================================

class ExamSectionBase(BaseModel):
    """Base exam section schema."""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    order: int = 0


class ExamSectionCreate(ExamSectionBase):
    """Schema for creating an exam section."""
    pass


class ExamSectionUpdate(BaseModel):
    """Schema for updating an exam section."""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    order: Optional[int] = None


# ============================================================
# QUESTION SCHEMAS
# ============================================================

class ExamQuestionBase(BaseModel):
    """Base exam question schema."""
    order: int = 0
    points: int = Field(1, ge=1)


class ExamQuestionCreate(ExamQuestionBase):
    """Schema for creating an exam question."""
    question_id: UUID
    section_id: Optional[UUID] = None


# ============================================================
# REGISTRATION SCHEMAS
# ============================================================

class ExamRegistrationBase(BaseModel):
    """Base exam registration schema."""
    pass


class ExamRegistrationCreate(BaseModel):
    """Schema for creating an exam registration."""
    user_id: UUID


class ExamRegistrationResponse(BaseModel):
    """Exam registration response schema."""
    id: UUID
    exam_id: UUID
    user_id: UUID
    status: str
    registered_at: datetime
    confirmed_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    total_score: Optional[float]
    max_score: Optional[float]
    percentage: Optional[float]
    passed: Optional[bool]
    exam: Optional[ExamResponse] = None
    user: Optional["UserResponse"] = None

    class Config:
        from_attributes = True


class RegistrationInfo(BaseModel):
    """Registration information for available exam."""
    id: UUID
    status: str
    registered_at: datetime
    confirmed_at: Optional[datetime]


# ============================================================
# SESSION SCHEMAS
# ============================================================

class ExamSessionBase(BaseModel):
    """Base exam session schema."""
    pass


class ExamSessionCreate(BaseModel):
    """Schema for creating an exam session."""
    registration_id: UUID


class ExamSessionResponse(BaseModel):
    """Exam session response schema."""
    id: UUID
    registration_id: UUID
    started_at: datetime
    ended_at: Optional[datetime]
    current_question_index: int = 0
    time_remaining_seconds: Optional[int]
    status: str
    created_at: datetime
    updated_at: Optional[datetime]
    registration: Optional[ExamRegistrationResponse] = None

    class Config:
        from_attributes = True


# ============================================================
# RESULT SCHEMAS
# ============================================================

class ExamResultBase(BaseModel):
    """Base exam result schema."""
    pass


class ExamResultCreate(BaseModel):
    """Schema for creating an exam result."""
    registration_id: UUID
    question_id: UUID
    answer: Optional[str] = None
    is_correct: bool = False
    points_earned: float = 0
    max_points: float = 0
    time_spent_seconds: Optional[int] = None


class ExamResultResponse(BaseModel):
    """Exam result response schema."""
    id: UUID
    registration_id: UUID
    question_id: UUID
    answer: Optional[str]
    is_correct: bool
    points_earned: float
    max_points: float
    time_spent_seconds: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]
    question: Optional[QuestionResponse] = None
    registration: Optional[ExamRegistrationResponse] = None

    class Config:
        from_attributes = True


# ============================================================
# CANDIDATE SCHEMAS
# ============================================================

class AssignCandidatesRequest(BaseModel):
    """Request schema for assigning candidates to an exam."""
    candidate_ids: List[UUID]


class SyncCandidatesRequest(BaseModel):
    """Request schema for syncing candidates to an exam."""
    add_candidate_ids: List[UUID] = []
    remove_candidate_ids: List[UUID] = []


class CandidateSessionSummary(BaseModel):
    """Candidate session summary schema."""
    user_id: UUID
    email: str
    first_name: str
    last_name: str
    registration_status: str
    session_status: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    total_score: Optional[float]
    percentage: Optional[float]
    passed: Optional[bool]
    time_spent_seconds: Optional[int]

    class Config:
        from_attributes = True


# ============================================================
# AVAILABLE EXAM SCHEMAS
# ============================================================

class AvailableExamResponse(BaseModel):
    """Available exam response schema."""
    id: UUID
    title: str
    description: Optional[str]
    duration_minutes: int
    passing_score: int
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    is_registered: bool = False
    registration: Optional[RegistrationInfo] = None
    total_questions: int = 0
    max_attempts: int = 1
    attempts_used: int = 0

    class Config:
        from_attributes = True


class ExamInstructionsResponse(BaseModel):
    """Exam instructions response schema."""
    exam_id: UUID
    exam_title: str
    exam_description: Optional[str]
    duration_minutes: int
    total_questions: int
    passing_score: int
    instructions: str = Field(
        default="Please read all questions carefully. You can navigate between questions using the navigation bar. You can flag questions for review. You must submit your answers before the timer expires."
    )
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    registration_id: UUID
    session_id: Optional[UUID] = None

    class Config:
        from_attributes = True


# ============================================================
# PAGINATED RESPONSE
# ============================================================

class PaginatedExamResponse(BaseModel):
    """Paginated exam response schema."""
    items: List[ExamResponse]
    total: int
    skip: int
    limit: int


# ============================================================
# ADD QUESTIONS SCHEMAS
# ============================================================

class AddQuestionsRequest(BaseModel):
    """Request schema for adding questions to an exam."""
    question_ids: List[UUID]
    section_id: Optional[UUID] = None
    order_start: int = 0
    points: int = Field(1, ge=1)


# ============================================================
# USER RESPONSE SCHEMA
# ============================================================

class UserResponse(BaseModel):
    """User response schema."""
    id: UUID
    email: str
    first_name: str
    last_name: str
    status: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "ExamBase",
    "ExamCreate",
    "ExamUpdate",
    "ExamResponse",
    "ExamDetailResponse",
    "ExamSectionBase",
    "ExamSectionCreate",
    "ExamSectionUpdate",
    "ExamSectionResponse",
    "ExamQuestionBase",
    "ExamQuestionCreate",
    "ExamQuestionResponse",
    "QuestionResponse",
    "ExamRegistrationBase",
    "ExamRegistrationCreate",
    "ExamRegistrationResponse",
    "RegistrationInfo",
    "ExamSessionBase",
    "ExamSessionCreate",
    "ExamSessionResponse",
    "ExamResultBase",
    "ExamResultCreate",
    "ExamResultResponse",
    "AssignCandidatesRequest",
    "SyncCandidatesRequest",
    "CandidateSessionSummary",
    "AvailableExamResponse",
    "ExamInstructionsResponse",
    "PaginatedExamResponse",
    "AddQuestionsRequest",
    "UserResponse",
]