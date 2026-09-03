import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings


async def test_connection():
    DATABASE_URL = settings.ASYNC_DATABASE_URL

    print("Testing database connection...")
    print("Database:", DATABASE_URL.split("@")[-1])

    engine = create_async_engine(DATABASE_URL)

    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT current_database()")
            )
            db_name = result.scalar()

            print(f"Connected to database: {db_name}")

            result = await conn.execute(
                text("SELECT id, name FROM tenants LIMIT 5")
            )

            rows = result.fetchall()

            if not rows:
                print("No tenants found.")
            else:
                for row in rows:
                    print(f"Tenant: {row.id} - {row.name}")

    finally:
        await engine.dispose()


if __name__ == "__main__":
    import selectors

    asyncio.run(
        test_connection(),
        loop_factory=lambda: asyncio.SelectorEventLoop(
            selectors.SelectSelector()
        ),
    )