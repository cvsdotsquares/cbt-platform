import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from '@cbt/shared';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { parsePage, parseLimit } from '../../common/utils/pagination.util';

const BCRYPT_ROUNDS = 12;

/** Student accounts live under Candidates — never shown or assignable on Staff & Teachers. */
const STUDENT_ROLES = [Role.CANDIDATE, Role.STUDENT] as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, page?: unknown, limit?: unknown, search?: string) {
    const p = parsePage(page);
    const l = parseLimit(limit);
    const where = {
      tenantId,
      // Staff & Teachers only — exclude pure students/candidates
      userRoles: {
        some: { role: { name: { notIn: [...STUDENT_ROLES] } } },
      },
      ...(search && {
        OR: [
          { email: { contains: search } },
          { firstName: { contains: search } },
          { lastName: { contains: search } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (p - 1) * l,
        take: l,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          mfaEnabled: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: { include: { role: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    const userIds = items.map((u) => u.id);
    const assignments = userIds.length
      ? await this.prisma.teacherAssignment.findMany({
          where: {
            userId: { in: userIds },
            batch: { tenantId },
          },
          select: {
            userId: true,
            batch: {
              select: {
                id: true,
                name: true,
                academicYear: true,
                academicClass: { select: { name: true, level: true } },
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
        })
      : [];

    const batchesByUser = new Map<string, { id: string; label: string }[]>();
    for (const a of assignments) {
      const list = batchesByUser.get(a.userId) ?? [];
      if (!list.some((b) => b.id === a.batch.id)) {
        list.push({
          id: a.batch.id,
          label: `${a.batch.academicClass.name} · ${a.batch.name}`,
        });
      }
      batchesByUser.set(a.userId, list);
    }

    return {
      items: items.map((u) => ({
        ...u,
        assignedBatches: batchesByUser.get(u.id) ?? [],
      })),
      total,
      page: p,
      limit: l,
      totalPages: Math.ceil(total / l),
    };
  }

  async findOne(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash: _, mfaSecret: __, ...safeUser } = user;
    return safeUser;
  }

  async getRoles(callerRoles: string[] = []) {
    const roles = await this.prisma.role.findMany({
      where: { isSystem: true, name: { notIn: [...STUDENT_ROLES] } },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
    if (!callerRoles.includes('SUPER_ADMIN')) {
      return roles.filter((r) => r.name !== 'SUPER_ADMIN');
    }
    return roles;
  }

  private assertStaffRoles(roles: { name: string }[]) {
    if (roles.some((r) => STUDENT_ROLES.includes(r.name as (typeof STUDENT_ROLES)[number]))) {
      throw new BadRequestException('Student/candidate roles are managed from the Students page');
    }
  }

  async create(
    tenantId: string,
    data: { email: string; password: string; firstName: string; lastName: string; roleIds?: string[] },
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: data.email } },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    // Staff accounts get at most one role
    const roleIds = (data.roleIds ?? []).slice(0, 1);

    if (roleIds.length) {
      const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds }, isSystem: true } });
      if (roles.length !== roleIds.length) throw new BadRequestException('One or more roles are invalid');
      this.assertStaffRoles(roles);
    }

    return this.prisma.user.create({
      data: {
        tenantId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        status: 'ACTIVE',
        emailVerified: true,
        userRoles: roleIds.length
          ? { create: [{ roleId: roleIds[0] }] }
          : undefined,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        userRoles: { include: { role: { select: { name: true } } } },
      },
    });
  }

  /** Replace staff roles with a single role (one role per staff user). */
  async assignRole(userId: string, roleId: string, assignedBy: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('User not found');

    const role = await this.prisma.role.findFirst({ where: { id: roleId, isSystem: true } });
    if (!role) throw new BadRequestException('Invalid role');
    this.assertStaffRoles([role]);

    await this.prisma.userRole.deleteMany({ where: { userId } });

    return this.prisma.userRole.create({
      data: { userId, roleId, assignedBy },
      include: { role: true },
    });
  }

  async removeRole(userId: string, roleId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('User not found');

    const assignment = await this.prisma.userRole.findFirst({ where: { userId, roleId } });
    if (!assignment) throw new BadRequestException('Role not assigned');

    return this.prisma.userRole.delete({ where: { id: assignment.id } });
  }

  async update(
    id: string,
    tenantId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
      password?: string;
      /** Single staff role — replaces any existing roles when provided (empty string clears). */
      roleId?: string | null;
    },
    assignedBy?: string,
  ) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found');

    if (data.email && data.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: data.email } },
      });
      if (existing) throw new ConflictException('Email already in use');
    }

    const updateData: {
      firstName?: string;
      lastName?: string;
      email?: string;
      status?: typeof data.status;
      passwordHash?: string;
    } = {};

    if (data.firstName !== undefined) updateData.firstName = data.firstName.trim();
    if (data.lastName !== undefined) updateData.lastName = data.lastName.trim();
    if (data.email !== undefined) updateData.email = data.email.trim().toLowerCase();
    if (data.status !== undefined) updateData.status = data.status;
    if (data.password?.trim()) {
      updateData.passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    if (data.roleId !== undefined) {
      if (data.roleId) {
        const role = await this.prisma.role.findFirst({ where: { id: data.roleId, isSystem: true } });
        if (!role) throw new BadRequestException('Invalid role');
        this.assertStaffRoles([role]);
        await this.prisma.userRole.deleteMany({ where: { userId: id } });
        await this.prisma.userRole.create({
          data: { userId: id, roleId: data.roleId, assignedBy: assignedBy ?? null },
        });
      } else {
        await this.prisma.userRole.deleteMany({ where: { userId: id } });
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: { include: { role: { select: { id: true, name: true } } } },
      },
    });
  }

  async remove(id: string, tenantId: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      include: {
        candidate: { select: { id: true } },
        userRoles: { include: { role: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.candidate) {
      throw new BadRequestException(
        'This user is a student account. Manage them from the Students page instead.',
      );
    }

    if (user.userRoles.some((ur) => ur.role.name === 'SUPER_ADMIN')) {
      throw new BadRequestException('Cannot delete a super admin account');
    }

    await this.prisma.session.deleteMany({ where: { userId: id } });

    return this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
  }
}
