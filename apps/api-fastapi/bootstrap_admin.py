import asyncio
import selectors
import uuid

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.tenant import Tenant, TenantIsolationMode
from app.models.user import User, UserStatus, user_roles
from app.models.role import Role
from app.models.permission import Permission
from app.models.role_permission import RolePermission


ADMIN_EMAIL = "admin@cbt-platform.com"
ADMIN_PASSWORD = "Admin@123"

TENANT_NAME = "CBT Development Tenant"
TENANT_SLUG = "cbt-development"


async def bootstrap_admin():
    async with AsyncSessionLocal() as db:

        print("=" * 60)
        print("CBT ADMIN BOOTSTRAP")
        print("=" * 60)

        # --------------------------------------------------------
        # 1. FIND OR CREATE TENANT
        # --------------------------------------------------------

        result = await db.execute(
            select(Tenant).where(
                Tenant.slug == TENANT_SLUG
            )
        )

        tenant = result.scalar_one_or_none()

        if tenant is None:
            tenant = Tenant(
                id=uuid.uuid4(),
                name=TENANT_NAME,
                slug=TENANT_SLUG,
                isolation_mode=TenantIsolationMode.SCHEMA,
                is_active=True,
            )

            db.add(tenant)
            await db.flush()

            print("TENANT CREATED")
        else:
            print("TENANT ALREADY EXISTS")

        print("Tenant ID :", tenant.id)
        print("Tenant    :", tenant.name)
        print("Slug      :", tenant.slug)

        # --------------------------------------------------------
        # 2. FIND OR CREATE ADMIN USER
        # --------------------------------------------------------

        result = await db.execute(
            select(User).where(
                User.email == ADMIN_EMAIL
            )
        )

        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                id=uuid.uuid4(),
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                first_name="Admin",
                last_name="User",
                tenant_id=tenant.id,
                status=UserStatus.ACTIVE,
                is_active=True,
                failed_attempts=0,
                mfa_enabled=False,
            )

            db.add(user)
            await db.flush()

            print("ADMIN USER CREATED")

        else:
            print("ADMIN USER ALREADY EXISTS")

            user.tenant_id = tenant.id
            user.status = UserStatus.ACTIVE
            user.is_active = True

        print("User ID   :", user.id)
        print("Email     :", user.email)
        print("Tenant ID :", user.tenant_id)

        # --------------------------------------------------------
        # 3. FIND OR CREATE ADMIN ROLE
        # --------------------------------------------------------

        result = await db.execute(
            select(Role).where(
                Role.tenant_id == tenant.id,
                Role.name == "admin",
            )
        )

        admin_role = result.scalar_one_or_none()

        if admin_role is None:
            admin_role = Role(
                id=uuid.uuid4(),
                name="admin",
                description="System administrator",
                tenant_id=tenant.id,
                is_active=True,
            )

            db.add(admin_role)
            await db.flush()

            print("ADMIN ROLE CREATED")
        else:
            print("ADMIN ROLE ALREADY EXISTS")

        print("Role ID   :", admin_role.id)
        print("Role Name :", admin_role.name)

        # --------------------------------------------------------
        # 4. FIND OR CREATE PERMISSION
        # --------------------------------------------------------

        result = await db.execute(
            select(Permission).where(
                Permission.code == "user:assign_role"
            )
        )

        permission = result.scalar_one_or_none()

        if permission is None:
            permission = Permission(
                id=uuid.uuid4(),
                code="user:assign_role",
                module="user",
                action="assign_role",
                description="Allows assigning and managing user roles",
            )

            db.add(permission)
            await db.flush()

            print("PERMISSION CREATED")
        else:
            print("PERMISSION ALREADY EXISTS")

        # --------------------------------------------------------
        # 5. ROLE -> PERMISSION
        # --------------------------------------------------------

        result = await db.execute(
            select(RolePermission).where(
                RolePermission.role_id == admin_role.id,
                RolePermission.permission_id == permission.id,
            )
        )

        role_permission = result.scalar_one_or_none()

        if role_permission is None:
            db.add(
                RolePermission(
                    role_id=admin_role.id,
                    permission_id=permission.id,
                )
            )

            print("PERMISSION ASSIGNED TO ADMIN ROLE")
        else:
            print("PERMISSION ALREADY ASSIGNED")

        # --------------------------------------------------------
        # 6. USER -> ADMIN ROLE
        # --------------------------------------------------------

        result = await db.execute(
            select(user_roles).where(
                user_roles.c.user_id == user.id,
                user_roles.c.role_id == admin_role.id,
            )
        )

        user_role = result.first()

        if user_role is None:
            await db.execute(
                user_roles.insert().values(
                    user_id=user.id,
                    role_id=admin_role.id,
                )
            )

            print("ADMIN ROLE ASSIGNED TO USER")
        else:
            print("ADMIN ROLE ALREADY ASSIGNED")

        # --------------------------------------------------------
        # 7. COMMIT
        # --------------------------------------------------------

        await db.commit()

        print()
        print("=" * 60)
        print("ADMIN BOOTSTRAP COMPLETE")
        print("=" * 60)
        print("Email     :", ADMIN_EMAIL)
        print("Password  :", ADMIN_PASSWORD)
        print("Tenant ID :", tenant.id)
        print("Role      :", admin_role.name)
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(
        bootstrap_admin(),
        loop_factory=lambda: asyncio.SelectorEventLoop(
            selectors.SelectSelector()
        ),
    )