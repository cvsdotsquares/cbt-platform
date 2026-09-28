"""One-off: permanently delete inactive staff users (non-student, non-super-admin)."""

from __future__ import annotations

import asyncio
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.routers.user import _hard_delete_users

_STAFF = """
EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.name NOT IN ('CANDIDATE', 'STUDENT')
)
"""

_NO_SUPER = """
NOT EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.name = 'SUPER_ADMIN'
)
"""


async def main() -> None:
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            text(
                f"""
                SELECT u.id, u.email, u.tenant_id
                FROM users u
                WHERE u.status != 'ACTIVE'
                  AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.user_id = u.id)
                  AND {_STAFF.strip()}
                  AND {_NO_SUPER.strip()}
                """
            )
        )
        users = [dict(r) for r in rows.mappings()]
        if not users:
            print("No inactive staff accounts to remove.")
            return

        by_tenant: dict[str, list[dict]] = defaultdict(list)
        for u in users:
            by_tenant[str(u["tenant_id"])].append(u)

        deleted_total = 0
        for tenant_id, group in by_tenant.items():
            print(f"Tenant {tenant_id}: removing {len(group)} account(s)...")
            for u in group:
                print(f"  - {u['email']} ({u['id']})")
                try:
                    async with db.begin_nested():
                        deleted_total += await _hard_delete_users(db, [u["id"]], tenant_id)
                except Exception as exc:
                    print(f"  ! Skipped {u['id']}: {exc}")

        await db.commit()
        print(f"Done. Deleted {deleted_total} user row(s) from the database.")


if __name__ == "__main__":
    asyncio.run(main())
