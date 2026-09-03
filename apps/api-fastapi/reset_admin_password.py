import asyncio

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash


async def main():
    email = "admin@cbt-platform.com"
    new_password = "Admin@123"

    password_hash = get_password_hash(new_password)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                UPDATE users
                SET password_hash = :password_hash
                WHERE email = :email
                RETURNING id, email
            """),
            {
                "password_hash": password_hash,
                "email": email,
            },
        )

        user = result.mappings().first()

        if not user:
            print("USER NOT FOUND")
            return

        await db.commit()

        print("PASSWORD RESET SUCCESSFULLY")
        print("USER ID:", user["id"])
        print("EMAIL:", user["email"])


if __name__ == "__main__":
    asyncio.run(main())