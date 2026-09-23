# app/services/exam_service.py
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.orm import selectinload

from app.models import (
    Exam,
    ExamStatus,
    ExamSection,
    ExamQuestion,
    ExamRegistration,
    ExamRegistrationStatus,
    ExamResult,
    ExamSession,
    Question,
    User,
    Candidate,
)
from app.schemas.exam import (
    ExamCreate,
    ExamUpdate,
    ExamSectionCreate,
    AddQuestionsRequest,
    AssignCandidatesRequest,
    SyncCandidatesRequest,
)


class ExamService:
    """Service for exam operations."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    # ============================================================
    # EXAM CRUD OPERATIONS
    # ============================================================
    
    async def create_exam(self, exam_data: ExamCreate, user_id: UUID) -> Exam:
        """Create a new exam."""
        exam = Exam(
            title=exam_data.title,
            description=exam_data.description,
            duration_minutes=exam_data.duration_minutes,
            passing_score=exam_data.passing_score,
            max_attempts=exam_data.max_attempts,
            starts_at=exam_data.starts_at,
            ends_at=exam_data.ends_at,
            status=exam_data.status or ExamStatus.DRAFT,
            created_by_id=user_id,
            is_active=True,
        )

        console.log(f"Creating exam: {exam.title} by user {user_id}")
        self.db.add(exam)
        await self.db.commit()
        await self.db.refresh(exam)
        return exam
    
    async def get_exam_by_id(self, exam_id: UUID) -> Optional[Exam]:
        """Get exam by ID with relationships."""
        query = (
            select(Exam)
            .where(Exam.id == exam_id)
            .options(
                selectinload(Exam.sections),
                selectinload(Exam.exam_questions),
                selectinload(Exam.registrations),
            )
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()
    
    async def get_exams(self, skip: int = 0, limit: int = 100, status: Optional[str] = None, search: Optional[str] = None) -> tuple[List[Exam], int]:
        """Get list of exams with pagination."""
        query = select(Exam)
        
        if status:
            query = query.where(Exam.status == status)
        
        if search:
            query = query.where(
                or_(
                    Exam.title.ilike(f"%{search}%"),
                    Exam.description.ilike(f"%{search}%")
                )
            )
        
        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = await self.db.scalar(count_query)
        
        # Get paginated results
        query = query.offset(skip).limit(limit).order_by(Exam.created_at.desc())
        result = await self.db.execute(query)
        exams = result.scalars().all()
        
        return exams, total
    
    async def update_exam(self, exam_id: UUID, exam_data: ExamUpdate, user_id: UUID) -> Optional[Exam]:
        """Update an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        # Update fields
        update_data = exam_data.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(exam, field, value)
        
        exam.updated_at = datetime.utcnow()
        await self.db.commit()
        await self.db.refresh(exam)
        return exam
    
    async def delete_exam(self, exam_id: UUID) -> bool:
        """Delete an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return False
        
        await self.db.delete(exam)
        await self.db.commit()
        return True
    
    # ============================================================
    # EXAM SECTIONS
    # ============================================================
    
    async def add_section(self, exam_id: UUID, section_data: ExamSectionCreate) -> Optional[ExamSection]:
        """Add a section to an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        section = ExamSection(
            exam_id=exam_id,
            title=section_data.title,
            description=section_data.description,
            order=section_data.order,
        )
        self.db.add(section)
        await self.db.commit()
        await self.db.refresh(section)
        return section
    
    async def remove_section(self, exam_id: UUID, section_id: UUID) -> bool:
        """Remove a section from an exam."""
        query = select(ExamSection).where(
            ExamSection.id == section_id,
            ExamSection.exam_id == exam_id
        )
        result = await self.db.execute(query)
        section = result.scalar_one_or_none()
        
        if not section:
            return False
        
        await self.db.delete(section)
        await self.db.commit()
        return True
    
    # ============================================================
    # EXAM QUESTIONS
    # ============================================================
    
    async def add_questions_to_exam(self, exam_id: UUID, request: AddQuestionsRequest) -> Optional[List[ExamQuestion]]:
        """Add questions to an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        questions = []
        for idx, question_id in enumerate(request.question_ids):
            exam_question = ExamQuestion(
                exam_id=exam_id,
                question_id=question_id,
                section_id=request.section_id,
                order=request.order_start + idx,
                points=request.points,
            )
            self.db.add(exam_question)
            questions.append(exam_question)
        
        await self.db.commit()
        return questions
    
    async def remove_question_from_exam(self, exam_id: UUID, question_id: UUID) -> bool:
        """Remove a question from an exam."""
        query = select(ExamQuestion).where(
            ExamQuestion.exam_id == exam_id,
            ExamQuestion.question_id == question_id
        )
        result = await self.db.execute(query)
        exam_question = result.scalar_one_or_none()
        
        if not exam_question:
            return False
        
        await self.db.delete(exam_question)
        await self.db.commit()
        return True
    
    # ============================================================
    # EXAM REGISTRATIONS
    # ============================================================
    
    async def register_user_for_exam(self, exam_id: UUID, user_id: UUID) -> Optional[ExamRegistration]:
        """Register a user for an exam."""
        # Check if exam exists
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        # Check if already registered
        query = select(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id,
            ExamRegistration.user_id == user_id
        )
        result = await self.db.execute(query)
        existing = result.scalar_one_or_none()
        
        if existing:
            return existing
        
        # Create registration
        registration = ExamRegistration(
            exam_id=exam_id,
            user_id=user_id,
            status=ExamRegistrationStatus.PENDING,
            registered_at=datetime.utcnow(),
        )
        self.db.add(registration)
        await self.db.commit()
        await self.db.refresh(registration)
        return registration
    
    async def get_exam_registrations(self, exam_id: UUID) -> List[ExamRegistration]:
        """Get all registrations for an exam."""
        query = select(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id
        ).options(selectinload(ExamRegistration.user))
        result = await self.db.execute(query)
        return result.scalars().all()
    
    async def assign_candidates(self, exam_id: UUID, request: AssignCandidatesRequest) -> bool:
        """Assign candidates to an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return False
        
        for user_id in request.candidate_ids:
            # Check if already registered
            query = select(ExamRegistration).where(
                ExamRegistration.exam_id == exam_id,
                ExamRegistration.user_id == user_id
            )
            result = await self.db.execute(query)
            existing = result.scalar_one_or_none()
            
            if not existing:
                registration = ExamRegistration(
                    exam_id=exam_id,
                    user_id=user_id,
                    status=ExamRegistrationStatus.PENDING,
                    registered_at=datetime.utcnow(),
                )
                self.db.add(registration)
        
        await self.db.commit()
        return True
    
    async def sync_candidates(self, exam_id: UUID, request: SyncCandidatesRequest) -> Dict[str, Any]:
        """Sync candidates for an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        # Add candidates
        for user_id in request.add_candidate_ids:
            query = select(ExamRegistration).where(
                ExamRegistration.exam_id == exam_id,
                ExamRegistration.user_id == user_id
            )
            result = await self.db.execute(query)
            existing = result.scalar_one_or_none()
            
            if not existing:
                registration = ExamRegistration(
                    exam_id=exam_id,
                    user_id=user_id,
                    status=ExamRegistrationStatus.PENDING,
                    registered_at=datetime.utcnow(),
                )
                self.db.add(registration)
        
        # Remove candidates
        for user_id in request.remove_candidate_ids:
            query = select(ExamRegistration).where(
                ExamRegistration.exam_id == exam_id,
                ExamRegistration.user_id == user_id
            )
            result = await self.db.execute(query)
            registration = result.scalar_one_or_none()
            
            if registration:
                await self.db.delete(registration)
        
        await self.db.commit()
        return {
            "added": len(request.add_candidate_ids),
            "removed": len(request.remove_candidate_ids)
        }
    
    # ============================================================
    # EXAM SESSIONS
    # ============================================================
    
    async def get_available_exams(self, user_id: UUID) -> List[Exam]:
        """Get available exams for a user."""
        # Get exams that are active and published
        query = select(Exam).where(
            Exam.status == ExamStatus.PUBLISHED,
            Exam.is_active == True
        )
        result = await self.db.execute(query)
        return result.scalars().all()
    
    async def get_exam_instructions(self, exam_id: UUID, user_id: UUID) -> Optional[Dict[str, Any]]:
        """Get exam instructions."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        # Check registration
        query = select(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id,
            ExamRegistration.user_id == user_id
        )
        result = await self.db.execute(query)
        registration = result.scalar_one_or_none()
        
        if not registration:
            return None
        
        # Get question count
        question_query = select(func.count()).select_from(ExamQuestion).where(
            ExamQuestion.exam_id == exam_id
        )
        total_questions = await self.db.scalar(question_query)
        
        return {
            "exam_id": exam.id,
            "exam_title": exam.title,
            "exam_description": exam.description,
            "duration_minutes": exam.duration_minutes,
            "total_questions": total_questions or 0,
            "passing_score": exam.passing_score,
            "starts_at": exam.starts_at,
            "ends_at": exam.ends_at,
            "registration_id": registration.id,
            "session_id": None
        }
    
    async def start_exam_session(self, exam_id: UUID, user_id: UUID) -> Optional[ExamSession]:
        """Start an exam session."""
        # Check registration
        query = select(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id,
            ExamRegistration.user_id == user_id,
            ExamRegistration.status.in_([ExamRegistrationStatus.PENDING, ExamRegistrationStatus.CONFIRMED])
        )
        result = await self.db.execute(query)
        registration = result.scalar_one_or_none()
        
        if not registration:
            return None
        
        # Check if session already exists
        session_query = select(ExamSession).where(
            ExamSession.registration_id == registration.id
        )
        result = await self.db.execute(session_query)
        existing_session = result.scalar_one_or_none()
        
        if existing_session:
            return existing_session
        
        # Create session
        session = ExamSession(
            registration_id=registration.id,
            started_at=datetime.utcnow(),
            status="ACTIVE",
            current_question_index=0,
        )
        self.db.add(session)
        
        # Update registration status
        registration.status = ExamRegistrationStatus.STARTED
        registration.started_at = datetime.utcnow()
        
        await self.db.commit()
        await self.db.refresh(session)
        return session
    
    async def get_current_session(self, user_id: UUID) -> Optional[ExamSession]:
        """Get current active session for a user."""
        query = select(ExamSession).join(
            ExamRegistration
        ).where(
            ExamRegistration.user_id == user_id,
            ExamSession.status == "ACTIVE"
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()
    
    async def get_session(self, session_id: UUID, user_id: UUID) -> Optional[ExamSession]:
        """Get a specific session."""
        query = select(ExamSession).join(
            ExamRegistration
        ).where(
            ExamSession.id == session_id,
            ExamRegistration.user_id == user_id
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()
    
    # ============================================================
    # EXAM RESULTS
    # ============================================================
    
    async def submit_exam(self, session_id: UUID, user_id: UUID) -> Optional[ExamResult]:
        """Submit an exam session."""
        session = await self.get_session(session_id, user_id)
        if not session or session.status != "ACTIVE":
            return None
        
        # Update session
        session.status = "COMPLETED"
        session.ended_at = datetime.utcnow()
        
        # Update registration
        registration = await self.db.get(ExamRegistration, session.registration_id)
        if registration:
            registration.status = ExamRegistrationStatus.COMPLETED
            registration.completed_at = datetime.utcnow()
        
        # Calculate results (simplified)
        # In a real implementation, you'd calculate scores from answers
        result = ExamResult(
            registration_id=session.registration_id,
            question_id=UUID("00000000-0000-0000-0000-000000000000"),  # Placeholder
            answer="Submitted",
            is_correct=True,
            points_earned=0,
            max_points=0,
            time_spent_seconds=0,
        )
        self.db.add(result)
        
        await self.db.commit()
        await self.db.refresh(result)
        return result
    
    async def get_exam_results(self, exam_id: UUID, user_id: UUID) -> List[ExamResult]:
        """Get results for an exam."""
        query = select(ExamResult).join(
            ExamRegistration
        ).where(
            ExamRegistration.exam_id == exam_id,
            ExamRegistration.user_id == user_id
        )
        result = await self.db.execute(query)
        return result.scalars().all()
    
    async def get_user_results(self, user_id: UUID) -> List[ExamResult]:
        """Get all results for a user."""
        query = select(ExamResult).join(
            ExamRegistration
        ).where(
            ExamRegistration.user_id == user_id
        )
        result = await self.db.execute(query)
        return result.scalars().all()
    
    async def get_result_detail(self, result_id: UUID, user_id: UUID) -> Optional[ExamResult]:
        """Get detailed result by ID."""
        query = select(ExamResult).join(
            ExamRegistration
        ).where(
            ExamResult.id == result_id,
            ExamRegistration.user_id == user_id
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()
    
    # ============================================================
    # CANDIDATE SUMMARIES
    # ============================================================
    
    async def get_candidate_summaries(self, exam_id: UUID) -> List[Dict[str, Any]]:
        """Get summaries for all candidates in an exam."""
        query = select(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id
        ).options(
            selectinload(ExamRegistration.user),
            selectinload(ExamRegistration.session)
        )
        result = await self.db.execute(query)
        registrations = result.scalars().all()
        
        summaries = []
        for reg in registrations:
            summary = {
                "user_id": reg.user_id,
                "email": reg.user.email if reg.user else "",
                "first_name": reg.user.first_name if reg.user else "",
                "last_name": reg.user.last_name if reg.user else "",
                "registration_status": reg.status,
                "session_status": reg.session.status if reg.session else None,
                "started_at": reg.started_at,
                "completed_at": reg.completed_at,
                "total_score": reg.total_score,
                "percentage": reg.percentage,
                "passed": reg.passed,
                "time_spent_seconds": None,
            }
            summaries.append(summary)
        
        return summaries
    
    # ============================================================
    # EXAM OVERVIEW
    # ============================================================
    
    async def get_exam_overview(self, exam_id: UUID) -> Optional[Dict[str, Any]]:
        """Get overview statistics for an exam."""
        exam = await self.get_exam_by_id(exam_id)
        if not exam:
            return None
        
        # Get registrations count
        reg_query = select(func.count()).select_from(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id
        )
        total_registrations = await self.db.scalar(reg_query)
        
        # Get questions count
        question_query = select(func.count()).select_from(ExamQuestion).where(
            ExamQuestion.exam_id == exam_id
        )
        total_questions = await self.db.scalar(question_query)
        
        # Get completed registrations count
        completed_query = select(func.count()).select_from(ExamRegistration).where(
            ExamRegistration.exam_id == exam_id,
            ExamRegistration.status == ExamRegistrationStatus.COMPLETED
        )
        completed_registrations = await self.db.scalar(completed_query)
        
        return {
            "exam_id": exam.id,
            "exam_title": exam.title,
            "total_registrations": total_registrations or 0,
            "completed_registrations": completed_registrations or 0,
            "total_questions": total_questions or 0,
            "status": exam.status,
            "created_at": exam.created_at,
            "starts_at": exam.starts_at,
            "ends_at": exam.ends_at,
        }