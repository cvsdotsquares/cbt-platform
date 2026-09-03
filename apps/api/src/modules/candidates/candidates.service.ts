import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@cbt/shared';
import { parsePage, parseLimit } from '../../common/utils/pagination.util';
import {
  CANDIDATE_VISIBLE_EXAM_STATUSES,
  assertExamVisibleToCandidate,
} from '../../common/utils/exam-visibility.util';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class CandidatesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    page?: unknown,
    limit?: unknown,
    search?: string,
    filters?: {
      batchId?: string;
      academicClassId?: string;
      unassigned?: boolean;
      /** When set, only students enrolled in these batches (teacher scope). */
      batchIds?: string[];
    },
  ) {
    const p = parsePage(page);
    const l = parseLimit(limit);

    // Teacher scope with no assignments → empty result
    if (filters?.batchIds && filters.batchIds.length === 0) {
      return { items: [], total: 0, page: p, limit: l, totalPages: 0 };
    }

    // Prefer explicit batchId when provided; otherwise restrict to assigned batchIds
    const enrollmentSome = (() => {
      if (filters?.unassigned) return undefined;

      const batchConstraint = filters?.batchId
        ? { batchId: filters.batchId }
        : filters?.batchIds
          ? { batchId: { in: filters.batchIds } }
          : {};

      if (filters?.academicClassId) {
        return {
          ...batchConstraint,
          batch: { academicClassId: filters.academicClassId },
        };
      }

      if (filters?.batchId || filters?.batchIds) {
        return batchConstraint;
      }

      return undefined;
    })();

    const where = {
      tenantId,
      ...(search && {
        OR: [
          { registrationNumber: { contains: search, mode: 'insensitive' as const } },
          { user: { email: { contains: search, mode: 'insensitive' as const } } },
          { user: { firstName: { contains: search, mode: 'insensitive' as const } } },
          { user: { lastName: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
      ...(enrollmentSome && {
        batchEnrollments: { some: enrollmentSome },
      }),
      ...(filters?.unassigned && {
        batchEnrollments: { none: {} },
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.candidate.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
          batchEnrollments: {
            orderBy: { enrolledAt: 'desc' },
            take: 1,
            include: {
              batch: {
                include: {
                  academicClass: { select: { id: true, name: true, level: true } },
                },
              },
            },
          },
        },
        skip: (p - 1) * l,
        take: l,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.candidate.count({ where }),
    ]);
    return { items, total, page: p, limit: l, totalPages: Math.ceil(total / l) };
  }

  async getKycStats(tenantId: string) {
    const [total, verified, pending, rejected] = await Promise.all([
      this.prisma.candidate.count({ where: { tenantId } }),
      this.prisma.candidate.count({ where: { tenantId, kycStatus: 'VERIFIED' } }),
      this.prisma.candidate.count({ where: { tenantId, kycStatus: 'PENDING' } }),
      this.prisma.candidate.count({ where: { tenantId, kycStatus: 'REJECTED' } }),
    ]);
    return { total, verified, pending, rejected };
  }

  async submitKyc(
    userId: string,
    data: { documentType: string; idNumber: string; fileName: string; fileData: string },
  ) {
    const candidate = await this.prisma.candidate.findUnique({ where: { userId } });
    if (!candidate) throw new NotFoundException('Candidate profile not found');
    if (!data.fileName?.trim() || !data.fileData?.trim()) {
      throw new BadRequestException('Document file is required');
    }
    if (data.fileData.length > 4_000_000) {
      throw new BadRequestException('Document is too large (max ~3MB)');
    }

    await this.prisma.candidateDocument.deleteMany({
      where: { candidateId: candidate.id, type: data.documentType },
    });

    await this.prisma.candidateDocument.create({
      data: {
        candidateId: candidate.id,
        type: data.documentType,
        fileName: data.fileName,
        fileUrl: data.fileData,
        fileSize: data.fileData.length,
        mimeType: data.fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
      },
    });

    return this.prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        kycStatus: 'PENDING',
        profileData: {
          ...(candidate.profileData as object),
          idNumber: data.idNumber,
          documentType: data.documentType,
          submittedAt: new Date().toISOString(),
        },
      },
    });
  }

  async findOne(id: string, tenantId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, tenantId },
      include: {
        user: { select: { email: true, firstName: true, lastName: true, phone: true } },
        documents: true,
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }

  async create(
    tenantId: string,
    data: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      registrationNumber?: string;
      batchId?: string;
      rollNumber?: string;
    },
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: data.email } },
    });
    if (existing) throw new ConflictException('Email already registered');

    const candidateRole = await this.prisma.role.findUnique({ where: { name: Role.CANDIDATE } });
    if (!candidateRole) throw new BadRequestException('Candidate role not configured');

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const regNo = data.registrationNumber || `CAND-${Date.now().toString().slice(-8)}`;

    const duplicateReg = await this.prisma.candidate.findFirst({
      where: { tenantId, registrationNumber: regNo },
    });
    if (duplicateReg) throw new ConflictException('Registration number already exists');

    if (data.batchId) {
      const batch = await this.prisma.batch.findFirst({
        where: { id: data.batchId, tenantId, isActive: true },
      });
      if (!batch) throw new BadRequestException('Batch not found');
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        status: 'ACTIVE',
        emailVerified: true,
        userRoles: { create: { roleId: candidateRole.id } },
        candidate: {
          create: {
            tenantId,
            registrationNumber: regNo,
            kycStatus: 'NOT_SUBMITTED',
          },
        },
      },
      include: {
        candidate: true,
        userRoles: { include: { role: { select: { name: true } } } },
      },
    });

    if (data.batchId && user.candidate) {
      await this.prisma.batchEnrollment.create({
        data: {
          batchId: data.batchId,
          candidateId: user.candidate.id,
          rollNumber: data.rollNumber?.trim() || null,
        },
      });
    }

    return user;
  }

  async updateKyc(id: string, tenantId: string, status: 'VERIFIED' | 'REJECTED') {
    const candidate = await this.prisma.candidate.findFirst({ where: { id, tenantId } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return this.prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        kycStatus: status,
        kycVerifiedAt: status === 'VERIFIED' ? new Date() : null,
      },
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      registrationNumber?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
      password?: string;
    },
  ) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, tenantId },
      include: { user: true },
    });
    if (!candidate) throw new NotFoundException('Student not found');

    if (data.email && data.email !== candidate.user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: data.email.trim().toLowerCase() } },
      });
      if (existing) throw new ConflictException('Email already in use');
    }

    if (data.registrationNumber && data.registrationNumber !== candidate.registrationNumber) {
      const dup = await this.prisma.candidate.findFirst({
        where: { tenantId, registrationNumber: data.registrationNumber, id: { not: id } },
      });
      if (dup) throw new ConflictException('Registration number already exists');
    }

    const userData: {
      firstName?: string;
      lastName?: string;
      email?: string;
      status?: typeof data.status;
      passwordHash?: string;
    } = {};

    if (data.firstName !== undefined) userData.firstName = data.firstName.trim();
    if (data.lastName !== undefined) userData.lastName = data.lastName.trim();
    if (data.email !== undefined) userData.email = data.email.trim().toLowerCase();
    if (data.status !== undefined) userData.status = data.status;
    if (data.password?.trim()) {
      userData.passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    }

    const [, updatedCandidate] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: candidate.userId }, data: userData }),
      this.prisma.candidate.update({
        where: { id },
        data: data.registrationNumber !== undefined
          ? { registrationNumber: data.registrationNumber.trim() }
          : {},
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
        },
      }),
    ]);

    return updatedCandidate;
  }

  /** Assign student to a class batch (replaces any existing batch). Pass batchId null to unassign. */
  async setBatchEnrollment(
    id: string,
    tenantId: string,
    data: { batchId: string | null; rollNumber?: string },
  ) {
    const candidate = await this.prisma.candidate.findFirst({ where: { id, tenantId } });
    if (!candidate) throw new NotFoundException('Student not found');

    if (!data.batchId) {
      await this.prisma.batchEnrollment.deleteMany({ where: { candidateId: id } });
      return { batch: null };
    }

    const batch = await this.prisma.batch.findFirst({
      where: { id: data.batchId, tenantId, isActive: true },
      include: { academicClass: { select: { id: true, name: true, level: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const rollNumber = data.rollNumber?.trim() || null;

    await this.prisma.$transaction([
      this.prisma.batchEnrollment.deleteMany({ where: { candidateId: id } }),
      this.prisma.batchEnrollment.create({
        data: { batchId: data.batchId, candidateId: id, rollNumber },
      }),
    ]);

    return {
      batch: {
        id: batch.id,
        name: batch.name,
        academicYear: batch.academicYear,
        academicClass: batch.academicClass,
        rollNumber,
      },
    };
  }

  /** Deactivate a student who left the institute — keeps exam history, removes batch access. */
  async remove(id: string, tenantId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, tenantId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!candidate) throw new NotFoundException('Student not found');

    const inProgress = await this.prisma.examSession.count({
      where: { candidateId: id, status: 'IN_PROGRESS' },
    });
    if (inProgress > 0) {
      throw new BadRequestException('Cannot remove a student while they have an exam in progress');
    }

    await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { userId: candidate.userId } }),
      this.prisma.batchEnrollment.deleteMany({ where: { candidateId: id } }),
      this.prisma.user.update({
        where: { id: candidate.userId },
        data: { status: 'INACTIVE' },
      }),
    ]);

    return {
      deactivated: true,
      id: candidate.id,
      name: `${candidate.user.firstName} ${candidate.user.lastName}`,
    };
  }

  async getDashboardByUser(userId: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { userId } });
    if (!candidate) throw new NotFoundException('Candidate profile not found');
    return this.getDashboard(candidate.id);
  }

  async getDashboard(candidateId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const [examCount, sessionStats, results] = await Promise.all([
      this.prisma.examRegistration.count({
        where: {
          candidateId,
          exam: { status: { in: [...CANDIDATE_VISIBLE_EXAM_STATUSES] } },
        },
      }),
      this.prisma.examSession.groupBy({
        by: ['status'],
        where: { candidateId },
        _count: true,
      }),
      this.prisma.examResult.findMany({
        where: { candidateId, published: true },
        select: { percentage: true },
      }),
    ]);

    const countByStatus = (status: string) =>
      sessionStats.find((s) => s.status === status)?._count ?? 0;
    const submittedExams = countByStatus('SUBMITTED') + countByStatus('AUTO_SUBMITTED');
    const inProgressExams = countByStatus('IN_PROGRESS');
    const averageScore = results.length
      ? results.reduce((sum, r) => sum + r.percentage, 0) / results.length
      : null;

    return {
      profile: {
        registrationNumber: candidate.registrationNumber,
        kycStatus: candidate.kycStatus,
        email: candidate.user.email,
        fullName: `${candidate.user.firstName} ${candidate.user.lastName}`,
      },
      stats: {
        totalExams: examCount,
        submittedExams,
        inProgressExams,
        publishedResults: results.length,
        averageScore,
      },
    };
  }

  async getAdmitCard(userId: string, examId: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { userId },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!candidate) throw new NotFoundException('Candidate profile not found');

    const registration = await this.prisma.examRegistration.findUnique({
      where: { examId_candidateId: { examId, candidateId: candidate.id } },
      include: { exam: true },
    });
    if (!registration) throw new NotFoundException('Not registered for this exam');
    assertExamVisibleToCandidate(registration.exam.status);

    const admitCardUrl = registration.admitCardUrl
      || `/admit-cards/${registration.id}`;

    if (!registration.admitCardUrl) {
      await this.prisma.examRegistration.update({
        where: { id: registration.id },
        data: { admitCardUrl, status: 'ADMIT_CARD_ISSUED' },
      });
    }

    return {
      admitCardId: registration.id,
      admitCardUrl,
      registrationNumber: candidate.registrationNumber,
      candidateName: `${candidate.user.firstName} ${candidate.user.lastName}`,
      candidateEmail: candidate.user.email,
      examTitle: registration.exam.title,
      examCode: registration.exam.code,
      startTime: registration.exam.startTime,
      endTime: registration.exam.endTime,
      timezone: registration.exam.timezone,
      venue: 'Online Proctored Examination',
      instructions: [
        'Arrive 15 minutes before the scheduled start time.',
        'Ensure a stable internet connection and working webcam.',
        'Keep a valid photo ID ready for verification.',
        'Fullscreen mode is required during the examination.',
      ],
    };
  }
}
