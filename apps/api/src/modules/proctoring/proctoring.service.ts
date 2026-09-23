import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WsBroadcastService } from '../../common/ws/ws-broadcast.service';
import { ProctoringEventType, ViolationSeverity } from '@prisma/client';

const VALID_EVENT_TYPES = new Set<string>(Object.values(ProctoringEventType));

const ACTIVE_MONITORING_STATUSES = ['IN_PROGRESS', 'PAUSED'] as const;

@Injectable()
export class ProctoringService {
  constructor(
    private prisma: PrismaService,
    private wsBroadcast: WsBroadcastService,
  ) {}

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
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: { select: { id: true, tenantId: true } },
        candidate: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const severity = data.severity || 'LOW';
    const event = await this.prisma.proctoringEvent.create({
      data: {
        sessionId,
        eventType,
        confidence: data.confidence,
        severity,
        metadata: data.metadata as never,
        snapshotUrl: data.snapshotUrl,
      },
    });

    const riskScore =
      severity === 'HIGH' || severity === 'CRITICAL' || severity === 'MEDIUM'
        ? await this.updateRiskScore(sessionId)
        : session.riskScore;

    const tenantId = session.exam.tenantId;
    const examId = session.exam.id;
    const candidateName = `${session.candidate.user.firstName} ${session.candidate.user.lastName}`;

    this.wsBroadcast.monitoringRoom(tenantId)?.emit('proctoring:risk-update', {
      sessionId,
      examId,
      riskScore,
      timestamp: new Date().toISOString(),
    });

    if (severity === 'HIGH' || severity === 'CRITICAL') {
      this.wsBroadcast.monitoringRoom(tenantId)?.emit('proctoring:violation', {
        sessionId,
        examId,
        candidateId: session.candidateId,
        candidateName,
        type: eventType,
        severity,
        confidence: data.confidence ?? 1,
        riskScore,
        timestamp: new Date().toISOString(),
      });
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

  async getEventDetail(eventId: string, tenantId: string) {
    const event = await this.prisma.proctoringEvent.findFirst({
      where: { id: eventId, session: { exam: { tenantId } } },
      include: {
        session: {
          include: {
            exam: { select: { id: true, title: true, code: true } },
            candidate: {
              include: {
                user: { select: { firstName: true, lastName: true, email: true } },
              },
            },
            proctoringEvents: { orderBy: { occurredAt: 'desc' }, take: 25 },
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Violation not found');

    const session = event.session;
    const counts = await this.prisma.proctoringEvent.groupBy({
      by: ['eventType'],
      where: { sessionId: session.id },
      _count: { eventType: true },
    });

    const formatLabel = (t: string) => {
      const labels: Record<string, string> = {
        TAB_SWITCH: 'Tab switch detected',
        WINDOW_BLUR: 'Window lost focus',
        FULLSCREEN_EXIT: 'Exited fullscreen',
        COPY_ATTEMPT: 'Copy attempt blocked',
        PASTE_ATTEMPT: 'Paste attempt blocked',
      };
      return labels[t] || t.replace(/_/g, ' ').toLowerCase();
    };

    const byType = counts
      .map((c) => ({
        eventType: c.eventType,
        label: formatLabel(c.eventType),
        count: c._count.eventType,
      }))
      .sort((a, b) => b.count - a.count);

    const totalViolations = byType.reduce((s, r) => s + r.count, 0);
    const tabSwitchCount = byType.find((r) => r.eventType === 'TAB_SWITCH')?.count ?? 0;
    const threshold = 3;

    return {
      event: {
        id: event.id,
        eventType: event.eventType,
        label: formatLabel(event.eventType),
        description: formatLabel(event.eventType),
        severity: event.severity,
        occurredAt: event.occurredAt.toISOString(),
        metadata: event.metadata as Record<string, unknown> | undefined,
      },
      student: {
        candidateId: session.candidateId,
        name: `${session.candidate.user.firstName} ${session.candidate.user.lastName}`,
        email: session.candidate.user.email,
        registrationNumber: session.candidate.registrationNumber,
      },
      exam: session.exam,
      session: {
        sessionId: session.id,
        status: session.status,
        riskScore: session.riskScore,
        totalViolations,
        tabSwitchCount,
        autoSubmitThreshold: threshold,
        autoSubmitTriggered: totalViolations > threshold,
      },
      violationSummary: byType,
      recentEvents: session.proctoringEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        label: formatLabel(e.eventType),
        description: formatLabel(e.eventType),
        severity: e.severity,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  async getLiveMonitoring(examId: string, tenantId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, tenantId } });
    if (!exam) throw new NotFoundException('Exam not found');

    const sessions = await this.prisma.examSession.findMany({
      where: { examId, status: { in: [...ACTIVE_MONITORING_STATUSES] } },
      include: {
        candidate: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    const violationCounts = await this.prisma.proctoringEvent.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      _count: { _all: true },
    });
    const violationsBySession = new Map(
      violationCounts.map((row) => [row.sessionId, row._count._all]),
    );

    const securityPolicy = exam.securityPolicy as { proctoringEnabled?: boolean } | null;
    const proctoringEnabled = securityPolicy?.proctoringEnabled !== false;

    return {
      examId,
      activeCount: sessions.filter((s) => s.status === 'IN_PROGRESS').length,
      proctoringEnabled,
      candidates: sessions.map((s) => ({
        sessionId: s.id,
        candidateId: s.candidateId,
        name: `${s.candidate.user.firstName} ${s.candidate.user.lastName}`,
        riskScore: s.riskScore,
        status: s.status,
        timeRemaining: s.timeRemainingSeconds,
        recentViolations: violationsBySession.get(s.id) ?? 0,
      })),
    };
  }

  async intervene(sessionId: string, type: string, message?: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: { select: { tenantId: true, id: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');

    let newStatus = session.status;
    if (type === 'PAUSE') {
      await this.prisma.examSession.update({
        where: { id: sessionId },
        data: { status: 'PAUSED' },
      });
      newStatus = 'PAUSED';
    } else if (type === 'RESUME') {
      await this.prisma.examSession.update({
        where: { id: sessionId },
        data: { status: 'IN_PROGRESS' },
      });
      newStatus = 'IN_PROGRESS';
    } else if (type === 'TERMINATE') {
      await this.prisma.examSession.update({
        where: { id: sessionId },
        data: { status: 'TERMINATED', submittedAt: new Date() },
      });
      newStatus = 'TERMINATED';
    } else {
      throw new BadRequestException(`Unknown intervention type: ${type}`);
    }

    const tenantId = session.exam.tenantId;
    const examId = session.exam.id;
    const interventionMessage = message || `Proctor action: ${type}`;

    this.wsBroadcast.monitoringRoom(tenantId)?.emit('proctoring:candidate-status', {
      sessionId,
      examId,
      status: newStatus,
      lastActivity: new Date().toISOString(),
    });

    const proctoringPayload = { type, message: interventionMessage, fromProctor: true };
    this.wsBroadcast.candidateProctoringRoom(tenantId, sessionId)?.emit('proctoring:intervention', proctoringPayload);

    if (type === 'PAUSE') {
      this.wsBroadcast.sessionRoom(tenantId, sessionId)?.emit('exam:paused', {
        reason: type,
        message: interventionMessage,
      });
    } else if (type === 'RESUME') {
      this.wsBroadcast.sessionRoom(tenantId, sessionId)?.emit('exam:resumed', {
        timeRemaining: session.timeRemainingSeconds,
        message: interventionMessage,
      });
    } else if (type === 'TERMINATE') {
      this.wsBroadcast.sessionRoom(tenantId, sessionId)?.emit('exam:terminated', {
        reason: type,
        message: interventionMessage,
      });
    }

    return { sessionId, examId, action: type, status: newStatus, message: interventionMessage };
  }
}
