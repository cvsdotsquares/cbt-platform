import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTenantByHeaderCached } from '../utils/tenant-cache';

export interface TenantRequest extends Request {
  tenantId?: string;
  tenantSlug?: string;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction) {
    const tenantHeader = req.headers['x-tenant-id'] as string;
    const host = req.headers.host || '';

    let tenant = null;

    if (tenantHeader) {
      tenant = await resolveTenantByHeaderCached(this.prisma, tenantHeader);
    } else {
      const subdomain = host.split('.')[0];
      if (subdomain && subdomain !== 'localhost' && subdomain !== 'api') {
        tenant = await this.prisma.tenant.findFirst({
          where: { OR: [{ domain: host }, { slug: subdomain }] },
        });
      }
    }

    if (tenant) {
      req.tenantId = tenant.id;
      req.tenantSlug = tenant.slug;
    }

    next();
  }
}
