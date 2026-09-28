import { Role, type JwtPayload } from '@cbt/shared';
import { PrismaService } from '../../prisma/prisma.service';

const ELEVATED_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ORG_ADMIN,
  Role.INSTITUTE_ADMIN,
  Role.EXAM_MANAGER,
];

/** Pure teachers are scoped to TeacherAssignment rows; admins are not. */
export function isTeacherScoped(user: Pick<JwtPayload, 'roles'>): boolean {
  const roles = user.roles ?? [];
  if (!roles.includes(Role.TEACHER)) return false;
  return !roles.some((role) => ELEVATED_ROLES.includes(role));
}

export async function getTeacherAssignments(prisma: PrismaService, userId: string) {
  return prisma.teacherAssignment.findMany({
    where: { userId },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      batch: {
        select: {
          id: true,
          name: true,
          academicYear: true,
          academicClass: { select: { id: true, name: true, level: true } },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });
}

export async function getTeacherBatchIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const rows = await prisma.teacherAssignment.findMany({
    where: { userId },
    select: { batchId: true },
    distinct: ['batchId'],
  });
  return rows.map((r) => r.batchId);
}

export async function getTeacherSubjectIdsForBatch(
  prisma: PrismaService,
  userId: string,
  batchId: string,
): Promise<string[]> {
  const rows = await prisma.teacherAssignment.findMany({
    where: { userId, batchId },
    select: { subjectId: true },
  });
  return rows.map((r) => r.subjectId);
}

export async function getTeacherSubjectIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const rows = await prisma.teacherAssignment.findMany({
    where: { userId },
    select: { subjectId: true },
    distinct: ['subjectId'],
  });
  return rows.map((r) => r.subjectId);
}

export async function teacherHasSubjectAssigned(
  prisma: PrismaService,
  userId: string,
  subjectId: string,
): Promise<boolean> {
  const count = await prisma.teacherAssignment.count({ where: { userId, subjectId } });
  return count > 0;
}

export async function teacherHasBatchAccess(
  prisma: PrismaService,
  userId: string,
  batchId: string,
): Promise<boolean> {
  const count = await prisma.teacherAssignment.count({ where: { userId, batchId } });
  return count > 0;
}

export async function teacherHasSubjectAccess(
  prisma: PrismaService,
  userId: string,
  batchId: string,
  subjectId: string,
): Promise<boolean> {
  const count = await prisma.teacherAssignment.count({
    where: { userId, batchId, subjectId },
  });
  return count > 0;
}
