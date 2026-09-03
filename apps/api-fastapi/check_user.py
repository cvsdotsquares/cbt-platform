import asyncio

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.security import verify_password


async def main():
    print("=" * 50)
    print("STARTING USER + PASSWORD CHECK")
    print("=" * 50)

    email = "admin@cbt-platform.com"

    # Enter the SAME password you are using on the login page
    password = input("Enter password to test: ")

    async with AsyncSessionLocal() as db:

        result = await db.execute(
            text("""
                SELECT
                    id,
                    email,
                    tenant_id,
                    status,
                    email_verified,
                    password_hash
                FROM users
                WHERE email = :email
            """),
            {
                "email": email
            },
        )

        row = result.mappings().first()

        if not row:
            print()
            print(">>> USER DOES NOT EXIST <<<")
            return

        print()
        print(">>> USER FOUND <<<")
        print("ID:", row["id"])
        print("EMAIL:", row["email"])
        print("TENANT ID:", row["tenant_id"])
        print("STATUS:", row["status"])
        print("EMAIL VERIFIED:", row["email_verified"])
        print("PASSWORD HASH EXISTS:", bool(row["password_hash"]))

        print()
        print("TESTING PASSWORD...")

        try:
            password_valid = verify_password(
                password,
                row["password_hash"],
            )

            print("PASSWORD MATCH:", password_valid)

            if password_valid:
                print()
                print(">>> PASSWORD IS CORRECT <<<")
            else:
                print()
                print(">>> PASSWORD IS INCORRECT <<<")

        except Exception as e:
            print()
            print(">>> PASSWORD VERIFICATION ERROR <<<")
            print("ERROR TYPE:", type(e).__name__)
            print("ERROR:", e)

    print()
    print("=" * 50)
    print("CHECK FINISHED")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())