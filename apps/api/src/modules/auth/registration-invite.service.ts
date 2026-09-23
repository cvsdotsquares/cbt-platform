import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateRegistrationInviteToken,
  hashRegistrationInviteToken,
  normalizeInviteEmail,
} from '../../common/utils/registration-invite.util';

const DEFAULT_INVITE_TTL_DAYS = 14;

@Injectable()
export class RegistrationInviteService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async createInvite(
    tenantId: string,
    createdById: string,
    data: {
      email: string;
      firstName?: string;
      lastName?: string;
      batchId?: string;
      registrationNumber?: string;
      expiresInDays?: number;
    },
  ) {
    const email = normalizeInviteEmail(data.email);
    if (!email) throw new BadRequestException('Email is required');

    const existingUser = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (existingUser) throw new ConflictException('Email already registered');

    const pendingInvite = await this.prisma.registrationInvite.findFirst({
      where: { tenantId, email, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pendingInvite) {
      throw new ConflictException('An active invite already exists for this email');
    }

    if (data.batchId) {
      const batch = await this.prisma.batch.findFirst({
        where: { id: data.batchId, tenantId, isActive: true },
      });
      if (!batch) throw new BadRequestException('Batch not found');
    }

    const plainToken = generateRegistrationInviteToken();
    const ttlDays = data.expiresInDays ?? DEFAULT_INVITE_TTL_DAYS;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    const invite = await this.prisma.registrationInvite.create({
      data: {
        tenantId,
        email,
        tokenHash: hashRegistrationInviteToken(plainToken),
        firstName: data.firstName?.trim() || null,
        lastName: data.lastName?.trim() || null,
        batchId: data.batchId || null,
        registrationNumber: data.registrationNumber?.trim() || null,
        expiresAt,
        createdById,
      },
    });

    const appUrl = (this.config.get<string>('APP_URL') || 'http://localhost:3002').replace(/\/$/, '');
    const signupPath = `/register?invite=${encodeURIComponent(plainToken)}`;

    return {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt,
      inviteToken: plainToken,
      signupUrl: `${appUrl}${signupPath}`,
    };
  }

  async listInvites(tenantId: string, page = 1, limit = 20) {
    const p = Math.max(1, page);
    const l = Math.min(50, Math.max(1, limit));
    const where = { tenantId, usedAt: null, expiresAt: { gt: new Date() } };
    const [items, total] = await Promise.all([
      this.prisma.registrationInvite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          expiresAt: true,
          createdAt: true,
          batch: { select: { id: true, name: true, academicYear: true } },
        },
      }),
      this.prisma.registrationInvite.count({ where }),
    ]);
    return { items, total, page: p, limit: l, totalPages: Math.ceil(total / l) };
  }

  async validateInviteToken(plainToken: string) {
    const invite = await this.findActiveInvite(plainToken);
    if (!invite) throw new NotFoundException('Invite not found or expired');

    return {
      email: invite.email,
      firstName: invite.firstName,
      lastName: invite.lastName,
      expiresAt: invite.expiresAt,
    };
  }

  async consumeInvite(plainToken: string, email: string) {
    const invite = await this.findActiveInvite(plainToken);
    if (!invite) throw new BadRequestException('Invite not found or expired');

    const normalized = normalizeInviteEmail(email);
    if (normalized !== invite.email) {
      throw new BadRequestException('Email must match the invited address');
    }

    await this.prisma.registrationInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return invite;
  }

  private async findActiveInvite(plainToken: string) {
    const token = plainToken?.trim();
    if (!token) return null;

    const invite = await this.prisma.registrationInvite.findFirst({
      where: {
        tokenHash: hashRegistrationInviteToken(token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    return invite;
  }
}
