import asyncio
from sqlalchemy import text
from app.core.database import engine


async def check():
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT id, name FROM tenants")
        )

        rows = result.fetchall()

        print("\n========== TENANTS ==========")

        if not rows:
            print("NO TENANTS FOUND")

        for row in rows:
            print(row)

        print("=============================\n")


asyncio.run(check())