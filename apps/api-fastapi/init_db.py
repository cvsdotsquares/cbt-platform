import asyncio
import selectors
import sys
from pathlib import Path

# Add the app directory to the path if needed
sys.path.append(str(Path(__file__).parent))

from app.core.database import engine
from app.models import Base

# IMPORT ALL MODELS EXPLICITLY SO SQLALCHEMY KNOWS ABOUT THEM
from app.models.user import User
from app.models.session import Session
from app.models.question import Question
from app.models.question_version import QuestionVersion
from app.models.exam import Exam
from app.models.exam_section import ExamSection
from app.models.exam_question import ExamQuestion
from app.models.exam_registration import ExamRegistration
from app.models.exam_result import ExamResult
from app.models.exam_session import ExamSession
from app.models.candidate import Candidate
from app.models.tenant import Tenant
from app.models.role import Role
from app.models.permission import Permission
from app.models.user_role import UserRole
from app.models.role_permission import RolePermission
from app.models.topic import Topic
from app.models.login_history import LoginHistory
from app.models.refresh_token import RefreshToken


async def create_tables():
    """Create all tables in the database."""
    print("🔄 Creating database tables...")
    async with engine.begin() as conn:
        # This will create all tables defined in your models
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Tables created successfully!")


async def drop_tables():
    """Drop all tables in the database (use with caution!)."""
    print("⚠️  Dropping all database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    print("✅ Tables dropped successfully!")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Database management script")
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Drop all tables before creating them",
    )
    args = parser.parse_args()

    # Force the use of SelectorEventLoop on Windows
    loop_factory = lambda: asyncio.SelectorEventLoop(selectors.SelectSelector())

    async def main():
        if args.drop:
            await drop_tables()
        await create_tables()

    try:
        asyncio.run(main(), loop_factory=loop_factory)
        print("🎉 Database setup complete!")
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)