import asyncio
import uuid
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.core.security import verify_password

async def test_login():
    async with AsyncSessionLocal() as session:
        # Find the admin user
        result = await session.execute(
            select(User).where(User.email == "admin@cbt-platform.com")
        )
        user = result.scalar_one_or_none()
        
        if user:
            print(f"User found: {user.email}")
            print(f"User ID: {user.id}")
            print(f"Tenant ID: {user.tenant_id}")
            print(f"Status: {user.status}")
            print(f"Email verified: {user.email_verified}")
            
            # Test password verification
            # Note: You need to get the actual hashed password from the database
            # This is just to check if the user exists
        else:
            print("User not found!")

if __name__ == "__main__":
    asyncio.run(test_login())