import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTenantCached } from '../../common/utils/tenant-cache';
import { MfaService } from './mfa.service';
import {
  LoginDto,
  RegisterDto,
  MfaVerifyDto,
} from './dto/auth.dto';
import { Role, getPermissionsForRoles, JwtPayload } from '@cbt/shared';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mfa: MfaService,
  ) {}

  private isPublicRegistrationAllowed(): boolean {
    const explicit = this.config.get<string>('ALLOW_PUBLIC_REGISTRATION');
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    return this.config.get('NODE_ENV') !== 'production';
  }

  async register(dto: RegisterDto, ipAddress: string, userAgent: string) {
    if (!this.isPublicRegistrationAllowed()) {
      throw new ForbiddenException('Public registration is disabled');
    }

    const tenant = await this.resolveTenant(dto.tenantId);
    if (!tenant) throw new BadRequestException('Invalid tenant');

    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const candidateRole = await this.prisma.role.findUnique({
      where: { name: Role.CANDIDATE },
    });

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        status: 'ACTIVE',
        emailVerified: true,
        userRoles: candidateRole
          ? { create: { roleId: candidateRole.id } }
          : undefined,
        candidate: {
          create: {
            tenantId: tenant.id,
            registrationNumber: `CAND-${Date.now().toString().slice(-8)}`,
            kycStatus: 'NOT_SUBMITTED',
          },
        },
      },
      include: { userRoles: { include: { role: true } } },
    });

    await this.prisma.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress,
        userAgent,
        deviceFingerprint: dto.deviceFingerprint,
        success: true,
      },
    });

    return this.generateTokens(user, dto.deviceFingerprint, ipAddress, userAgent);
  }

  async login(dto: LoginDto, ipAddress: string, userAgent: string) {
    const tenant = await this.resolveTenant(dto.tenantId);
    if (!tenant) throw new BadRequestException('Invalid tenant');

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.handleFailedLogin(user.id, ipAddress, userAgent, dto.deviceFingerprint);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
      this.prisma.loginHistory.create({
        data: {
          userId: user.id,
          ipAddress,
          userAgent,
          deviceFingerprint: dto.deviceFingerprint,
          success: true,
        },
      }),
    ]);

    if (user.mfaEnabled && user.mfaSecret) {
      const mfaToken = this.jwt.sign(
        { sub: user.id, type: 'mfa' },
        { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: '5m' },
      );
      return { mfaRequired: true, mfaToken };
    }

    return this.generateTokens(user, dto.deviceFingerprint, ipAddress, userAgent);
  }

  async verifyMfa(dto: MfaVerifyDto, ipAddress: string, userAgent: string) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(dto.mfaToken, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    if (payload.type !== 'mfa') {
      throw new UnauthorizedException('Invalid MFA token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user?.mfaSecret) {
      throw new UnauthorizedException('MFA not configured');
    }

    const valid = this.mfa.verifyToken(user.mfaSecret, dto.totpCode);
    if (!valid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    return this.generateTokens(user, 'mfa-verified', ipAddress, userAgent);
  }

  async refreshToken(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash: tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: { include: { userRoles: { include: { role: true } } } },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(
      session.user,
      session.deviceFingerprint,
      session.ipAddress,
      session.userAgent,
    );
  }

  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logged out successfully' };
  }

  async setupMfa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const { secret, otpauthUrl } = this.mfa.generateSecret(user.email);
    const qrCode = await this.mfa.generateQrCode(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret },
    });

    return { secret, qrCode, otpauthUrl };
  }

  async confirmMfa(userId: string, totpCode: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret) throw new BadRequestException('MFA not initialized');

    const valid = this.mfa.verifyToken(user.mfaSecret, totpCode);
    if (!valid) throw new BadRequestException('Invalid TOTP code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    return { message: 'MFA enabled successfully' };
  }

  async getLoginHistory(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.loginHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.loginHistory.count({ where: { userId } }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceFingerprint: true,
        userAgent: true,
        ipAddress: true,
        isTrustedDevice: true,
        createdAt: true,
        expiresAt: true,
      },
    });
  }

  private async generateTokens(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      tenantId: string;
      mfaEnabled: boolean;
      userRoles: { role: { name: string } }[];
    },
    deviceFingerprint: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const roles = user.userRoles.map((ur) => ur.role.name as Role);
    const permissions = getPermissionsForRoles(roles);
    const sessionId = uuidv4();

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenantId: user.tenantId,
      roles,
      permissions: permissions as unknown as string[],
      sessionId,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshToken = uuidv4();
    const refreshExpiry = this.config.get('JWT_REFRESH_EXPIRY', '7d');
    const expiresAt = this.parseRefreshExpiry(refreshExpiry);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: this.hashToken(refreshToken),
        deviceFingerprint,
        userAgent,
        ipAddress,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
        tenantId: user.tenantId,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  private async handleFailedLogin(
    userId: string,
    ipAddress: string,
    userAgent: string,
    deviceFingerprint: string,
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedAttempts: { increment: 1 } },
    });

    await this.prisma.loginHistory.create({
      data: {
        userId,
        ipAddress,
        userAgent,
        deviceFingerprint,
        success: false,
        failureReason: 'Invalid password',
      },
    });

    if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
    }
  }

  private async resolveTenant(tenantId?: string) {
    return resolveTenantCached(this.prisma, tenantId);
  }

  private parseRefreshExpiry(expiry: string): Date {
    const match = /^(\d+)([smhd])$/i.exec(expiry.trim());
    const expiresAt = new Date();
    if (!match) {
      expiresAt.setDate(expiresAt.getDate() + 7);
      return expiresAt;
    }
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 's') expiresAt.setSeconds(expiresAt.getSeconds() + value);
    else if (unit === 'm') expiresAt.setMinutes(expiresAt.getMinutes() + value);
    else if (unit === 'h') expiresAt.setHours(expiresAt.getHours() + value);
    else expiresAt.setDate(expiresAt.getDate() + value);
    return expiresAt;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
