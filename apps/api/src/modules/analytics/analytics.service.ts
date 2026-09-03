import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats(tenantId: string) {
    const [
      totalExams,
      publishedExams,
      totalCandidates,
      totalQuestions,
      activeSessions,
      totalViolations,
      recentSubmissions,
      recentViolations,
    ] = await Promise.all([
      this.prisma.exam.count({ where: { tenantId } }),
      this.prisma.exam.count({ where: { tenantId, status: 'PUBLISHED' } }),
      this.prisma.candidate.count({ where: { tenantId } }),
      this.prisma.question.count({ where: { tenantId } }),
      this.prisma.examSession.count({ where: { status: 'IN_PROGRESS', exam: { tenantId } } }),
      this.prisma.proctoringEvent.count({
        where: { severity: { in: ['HIGH', 'CRITICAL'] }, session: { exam: { tenantId } } },
      }),
      this.prisma.examResult.findMany({
        where: { exam: { tenantId } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          exam: { select: { title: true, code: true } },
          candidate: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.proctoringEvent.findMany({
        where: { session: { exam: { tenantId } } },
        orderBy: { occurredAt: 'desc' },
        take: 5,
        include: {
          session: {
            include: {
              exam: { select: { title: true, code: true } },
              candidate: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      }),
    ]);

    const upcomingExams = await this.prisma.exam.findMany({
      where: { tenantId, status: { in: ['PUBLISHED', 'SCHEDULED'] }, endTime: { gte: new Date() } },
      orderBy: { startTime: 'asc' },
      take: 5,
      include: { _count: { select: { registrations: true } } },
    });

    return {
      stats: {
        totalExams,
        publishedExams,
        totalCandidates,
        totalQuestions,
        activeSessions,
        violationAlerts: totalViolations,
      },
      upcomingExams,
      recentSubmissions: recentSubmissions.map((r) => ({
        id: r.id,
        candidateName: `${r.candidate.user.firstName} ${r.candidate.user.lastName}`,
        examTitle: r.exam.title,
        examCode: r.exam.code,
        score: r.totalScore,
        maxScore: r.maxScore,
        percentage: r.percentage,
        submittedAt: r.createdAt,
        message: `${r.candidate.user.firstName} ${r.candidate.user.lastName} submitted ${r.exam.title}`,
      })),
      recentViolations: recentViolations.map((v) => ({
        id: v.id,
        eventType: v.eventType,
        label: this.formatViolationLabel(v.eventType),
        severity: v.severity,
        candidateName: `${v.session.candidate.user.firstName} ${v.session.candidate.user.lastName}`,
        examTitle: v.session.exam.title,
        occurredAt: v.occurredAt,
        message: `${this.formatViolationLabel(v.eventType)} during ${v.session.exam.title}`,
      })),
    };
  }

  private formatViolationLabel(eventType: string): string {
    const labels: Record<string, string> = {
      NO_FACE: 'No face detected',
      MULTIPLE_FACES: 'Multiple faces detected',
      FACE_MISMATCH: 'Face mismatch',
      LOOKING_AWAY: 'Candidate looked away',
      HEAD_TURNED: 'Head turned from screen',
      PHONE_DETECTED: 'Phone detected',
      AUDIO_ANOMALY: 'Audio anomaly',
      TAB_SWITCH: 'Tab switch detected',
      WINDOW_BLUR: 'Window lost focus',
      COPY_PASTE: 'Copy/paste attempt',
      RIGHT_CLICK: 'Right-click blocked',
      FULLSCREEN_EXIT: 'Exited fullscreen',
      MULTIPLE_MONITORS: 'Multiple monitors detected',
    };
    return labels[eventType] || eventType.replace(/_/g, ' ').toLowerCase();
  }

  async getExamAnalytics(examId: string, tenantId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, tenantId } });
    if (!exam) return null;

    const [registered, appeared, submitted, avgScore, violations] = await Promise.all([
      this.prisma.examRegistration.count({ where: { examId } }),
      this.prisma.examSession.count({ where: { examId } }),
      this.prisma.examSession.count({ where: { examId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } }),
      this.prisma.examResult.aggregate({ where: { examId }, _avg: { percentage: true } }),
      this.prisma.proctoringEvent.count({ where: { session: { examId }, severity: { in: ['HIGH', 'CRITICAL'] } } }),
    ]);

    return {
      examId,
      title: exam.title,
      registered,
      appeared,
      submitted,
      completionRate: appeared > 0 ? Math.round((submitted / appeared) * 100) : 0,
      averageScore: avgScore._avg.percentage ?? 0,
      violations,
    };
  }
}
