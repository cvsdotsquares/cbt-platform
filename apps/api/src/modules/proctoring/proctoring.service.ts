import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProctoringEventType, ViolationSeverity } from '@prisma/client';

const VALID_EVENT_TYPES = new Set<string>(Object.values(ProctoringEventType));

@Injectable()
export class ProctoringService {
  constructor(private prisma: PrismaService) {}

  async recordEventForUser(
    userId: string,
    sessionId: string,
    eventType: string,
    data: {
      confidence?: number;
      severity?: ViolationSeverity;
      metadata?: Record<string, unknown>;
      snapshotUrl?: string;
    },
  ) {
    if (!VALID_EVENT_TYPES.has(eventType)) {
      throw new BadRequestException(`Invalid event type: ${eventType}`);
    }

    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { candidate: { select: { userId: true } } },
    });
    if (!session || session.candidate.userId !== userId) {
      throw new ForbiddenException('Session does not belong to this candidate');
    }

    return this.recordEvent(sessionId, eventType as ProctoringEventType, data);
  }

  async recordEvent(
    sessionId: string,
    eventType: ProctoringEventType,
    data: {
      confidence?: number;
      severity?: ViolationSeverity;
      metadata?: Record<string, unknown>;
      snapshotUrl?: string;
    },
  ) {
    const event = await this.prisma.proctoringEvent.create({
      data: {
        sessionId,
        eventType,
        confidence: data.confidence,
        severity: data.severity || 'LOW',
        metadata: data.metadata as never,
        snapshotUrl: data.snapshotUrl,
      },
    });

    if (data.severity === 'HIGH' || data.severity === 'CRITICAL') {
      await this.updateRiskScore(sessionId);
    }

    return event;
  }

  async updateRiskScore(sessionId: string) {
    const recentEvents = await this.prisma.proctoringEvent.findMany({
      where: {
        sessionId,
        occurredAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      orderBy: { occurredAt: 'desc' },
    });

    const severityWeights: Record<string, number> = {
      LOW: 5,
      MEDIUM: 15,
      HIGH: 35,
      CRITICAL: 50,
    };

    let riskScore = 0;
    for (const event of recentEvents) {
      riskScore += severityWeights[event.severity] || 5;
    }
    riskScore = Math.min(riskScore, 100);

    await this.prisma.examSession.update({
      where: { id: sessionId },
      data: { riskScore },
    });

    return riskScore;
  }

  async getLiveMonitoring(examId: string) {
    const sessions = await this.prisma.examSession.findMany({
      where: { examId, status: 'IN_PROGRESS' },
      include: {
        candidate: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
        proctoringEvents: {
          where: { severity: { in: ['HIGH', 'CRITICAL'] } },
          orderBy: { occurredAt: 'desc' },
          take: 5,
        },
      },
    });

    return {
      activeCount: sessions.length,
      candidates: sessions.map((s) => ({
        sessionId: s.id,
        candidateId: s.candidateId,
        name: `${s.candidate.user.firstName} ${s.candidate.user.lastName}`,
        riskScore: s.riskScore,
        status: s.status,
        timeRemaining: s.timeRemainingSeconds,
        recentViolations: s.proctoringEvents.length,
      })),
    };
  }

  async intervene(sessionId: string, type: string, message?: string) {
    const session = await this.prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    if (type === 'PAUSE') {
      await this.prisma.examSession.update({
        where: { id: sessionId },
        data: { status: 'PAUSED' },
      });
    } else if (type === 'RESUME') {
      await this.prisma.examSession.update({
        where: { id: sessionId },
        data: { status: 'IN_PROGRESS' },
      });
    } else if (type === 'TERMINATE') {
      await this.prisma.examSession.update({
        where: { id: sessionId },
        data: { status: 'TERMINATED', submittedAt: new Date() },
      });
    }

    return { sessionId, action: type, message };
  }
}
