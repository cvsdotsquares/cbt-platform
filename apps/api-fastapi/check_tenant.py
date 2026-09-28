import asyncio

from sqlalchemy import text

from app.core.database import AsyncSessionLocal


async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, name, slug
                FROM tenants
                ORDER BY created_at
            """)
        )

        rows = result.mappings().all()

        print("NUMBER OF TENANTS:", len(rows))

        for row in rows:
            print("-" * 60)
            print("ID:", row["id"])
            print("NAME:", row["name"])
            print("SLUG:", row["slug"])


if __name__ == "__main__":
    asyncio.run(main())