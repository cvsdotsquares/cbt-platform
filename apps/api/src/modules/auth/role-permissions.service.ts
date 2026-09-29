import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CATALOG_CODES,
  CONFIGURABLE_ROLE_NAMES,
  CONFIGURABLE_ROLES,
  PERMISSION_COLUMNS,
  PERMISSION_MODULES,
  ROLE_PERMISSIONS_SETTINGS_KEY,
  defaultCatalogCodes,
  grantedCodes,
} from './role-permission.catalog';

type Settings = Record<string, unknown>;

@Injectable()
export class RolePermissionsService {
  private readonly cache = new Map<string, { at: number; settings: Settings }>();

  constructor(private prisma: PrismaService) {}

  async effectiveForRoles(tenantId: string | undefined, roles: string[]) {
    const overrides = tenantId ? await this.loadOverrides(tenantId) : {};
    const permissions = new Set<string>();
    let customized = false;
    for (const roleName of roles) {
      const key = roleName.toUpperCase();
      if (key in overrides) customized = true;
      for (const code of grantedCodes(roleName, overrides)) permissions.add(code);
    }
    return { permissions: [...permissions].sort(), customized };
  }

  async matrix(tenantId: string) {
    const settings = await this.loadSettings(tenantId);
    const overrides = this.overridesFrom(settings);
    const teachers = await this.listTeachers(tenantId);
    const roleGranted: Record<string, string[]> = {};
    const defaults: Record<string, string[]> = {};
    const customized: Record<string, boolean> = {};
    for (const role of CONFIGURABLE_ROLES) {
      roleGranted[role.name] = grantedCodes(role.name, overrides).filter((code) => CATALOG_CODES.has(code));
      defaults[role.name] = defaultCatalogCodes(role.name);
      customized[role.name] = role.name in overrides;
    }
    const used = new Set(PERMISSION_MODULES.flatMap((module) => Object.keys(module.cells)));
    const columns = PERMISSION_COLUMNS.filter((column) => used.has(column));
    return {
      roles: CONFIGURABLE_ROLES,
      columns,
      modules: PERMISSION_MODULES,
      teachers,
      granted: roleGranted,
      teacherGranted: Object.fromEntries(teachers.map((teacher) => [teacher.id, roleGranted.TEACHER ?? []])),
      defaults,
      customized,
      teacherCustomized: Object.fromEntries(teachers.map((teacher) => [teacher.id, false])),
    };
  }

  async save(
    tenantId: string,
    body: { role?: string; permissions?: string[]; reset?: boolean; userId?: string },
  ) {
    const key = (body.role ?? '').toUpperCase();
    if (!CONFIGURABLE_ROLE_NAMES.has(key)) {
      throw new BadRequestException('This role cannot be edited here');
    }
    if (body.userId) {
      throw new BadRequestException('Per-teacher permissions are disabled.');
    }
    const settings = await this.loadSettings(tenantId);
    const stored = this.asRecord(settings[ROLE_PERMISSIONS_SETTINGS_KEY]);
    if (body.reset) {
      delete stored[key];
    } else {
      stored[key] = this.cleanCatalogCodes(body.permissions);
    }
    settings[ROLE_PERMISSIONS_SETTINGS_KEY] = stored;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    this.cache.delete(tenantId);
    return this.matrix(tenantId);
  }

  private cleanCatalogCodes(permissions: string[] | undefined) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const code of permissions ?? []) {
      if (CATALOG_CODES.has(code) && !seen.has(code)) {
        cleaned.push(code);
        seen.add(code);
      }
    }
    return cleaned;
  }

  private async loadOverrides(tenantId: string) {
    return this.overridesFrom(await this.loadSettings(tenantId));
  }

  private overridesFrom(settings: Settings) {
    const raw = settings[ROLE_PERMISSIONS_SETTINGS_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const overrides: Record<string, string[]> = {};
    for (const [roleName, codes] of Object.entries(raw as Record<string, unknown>)) {
      const key = roleName.toUpperCase();
      if (!CONFIGURABLE_ROLE_NAMES.has(key) || !Array.isArray(codes)) continue;
      overrides[key] = codes.map(String).filter((code) => CATALOG_CODES.has(code));
    }
    return overrides;
  }

  private async loadSettings(tenantId: string): Promise<Settings> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < 15_000) return { ...cached.settings };
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = this.asRecord(tenant?.settings);
    this.cache.set(tenantId, { at: Date.now(), settings });
    return { ...settings };
  }

  private asRecord(value: unknown): Settings {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Settings) };
    }
    return {};
  }

  private async listTeachers(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        OR: [
          { userRoles: { some: { role: { name: { equals: 'TEACHER', mode: 'insensitive' } } } } },
          { id: { in: await this.assignedTeacherIds(tenantId) } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { batch: { tenantId }, userId: { in: users.map((user) => user.id) } },
      select: {
        userId: true,
        subject: { select: { name: true } },
        batch: { select: { name: true, academicClass: { select: { name: true } } } },
      },
    });
    const labels = new Map<string, string[]>();
    for (const row of assignments) {
      const place = [row.batch.academicClass?.name, row.batch.name].filter(Boolean).join(' · ');
      const label = [row.subject?.name, place].filter(Boolean).join(' · ');
      const list = labels.get(row.userId) ?? [];
      if (label && !list.includes(label)) list.push(label);
      labels.set(row.userId, list);
    }
    return users.map((user) => ({
      id: user.id,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      email: user.email || '',
      assignments: labels.get(user.id) ?? [],
    }));
  }

  private async assignedTeacherIds(tenantId: string) {
    const rows = await this.prisma.teacherAssignment.findMany({
      where: { batch: { tenantId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((row) => row.userId);
  }
}
