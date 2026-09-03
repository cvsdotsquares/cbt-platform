import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(data: { name: string; slug: string; domain?: string }) {
    return this.prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        domain: data.domain,
      },
    });
  }

  async findAll(page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count(),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async getBranding(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, branding: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateBranding(id: string, branding: Record<string, unknown>) {
    const existing = await this.prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tenant not found');

    const previous =
      existing.branding && typeof existing.branding === 'object' && !Array.isArray(existing.branding)
        ? (existing.branding as Record<string, unknown>)
        : {};

    return this.prisma.tenant.update({
      where: { id },
      data: { branding: { ...previous, ...branding } as never },
    });
  }

  async updateSecurityConfig(id: string, securityConfig: Record<string, unknown>) {
    return this.prisma.tenant.update({
      where: { id },
      data: { securityConfig: securityConfig as never },
    });
  }
}
