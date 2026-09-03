import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LearningService {
  constructor(private prisma: PrismaService) {}

  async getStudentDashboard(candidateId: string, tenantId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, tenantId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        batchEnrollments: {
          include: {
            batch: { include: { academicClass: true } },
          },
        },
        topicMasteries: {
          include: { topic: { include: { chapter: true } }, subject: true },
          orderBy: { accuracy: 'asc' },
          take: 20,
        },
        weakAreaRecommendations: {
          where: { isResolved: false },
          include: { topic: { include: { chapter: true } } },
          orderBy: { priority: 'desc' },
          take: 5,
        },
        results: {
          where: { published: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { exam: { select: { title: true, type: true } } },
        },
      },
    });
    if (!candidate) throw new NotFoundException('Student not found');

    const avgScore = candidate.results.length
      ? candidate.results.reduce((s, r) => s + r.percentage, 0) / candidate.results.length
      : null;

    const syllabusCoverage = await Promise.all(
      candidate.batchEnrollments.map(async (enrollment) => {
        const batchId = enrollment.batchId;
        // Only Done chapters — same scope used when creating AI class tests
        const progress = await this.prisma.syllabusProgress.findMany({
          where: {
            batchId,
            chapterId: { not: null },
            status: 'COMPLETED',
          },
          include: {
            chapter: {
              select: {
                id: true,
                number: true,
                title: true,
                book: { select: { subject: { select: { id: true, name: true } } } },
              },
            },
          },
        });

        const chapters = progress
          .filter((p) => p.chapter)
          .map((p) => ({
            id: p.chapter!.id,
            number: p.chapter!.number,
            title: p.chapter!.title,
            status: p.status,
            subject: p.chapter!.book.subject,
          }))
          .filter((ch, i, arr) => arr.findIndex((x) => x.id === ch.id) === i)
          .sort((a, b) =>
            a.subject.name.localeCompare(b.subject.name) || a.number - b.number,
          );

        const bySubject = new Map<string, {
          subject: { id: string; name: string };
          chapters: typeof chapters;
        }>();
        for (const ch of chapters) {
          const existing = bySubject.get(ch.subject.id);
          if (existing) existing.chapters.push(ch);
          else bySubject.set(ch.subject.id, { subject: ch.subject, chapters: [ch] });
        }

        return {
          batch: {
            id: enrollment.batch.id,
            name: enrollment.batch.name,
            className: enrollment.batch.academicClass.name,
          },
          chapters,
          subjects: [...bySubject.values()],
          stats: {
            total: chapters.length,
            done: chapters.length,
            studying: 0,
            subjectCount: bySubject.size,
          },
        };
      }),
    );

    return {
      profile: {
        fullName: `${candidate.user.firstName} ${candidate.user.lastName}`,
        email: candidate.user.email,
        registrationNumber: candidate.registrationNumber,
      },
      batches: candidate.batchEnrollments.map((e) => e.batch),
      stats: {
        totalTests: candidate.results.length,
        averageScore: avgScore,
        weakTopics: candidate.weakAreaRecommendations.length,
        masteredTopics: candidate.topicMasteries.filter((m) => m.accuracy >= 70).length,
        doneChapters: syllabusCoverage.reduce((sum, b) => sum + b.stats.done, 0),
      },
      recentResults: candidate.results,
      weakAreas: candidate.weakAreaRecommendations,
      topicMasteries: candidate.topicMasteries,
      syllabusCoverage,
    };
  }

  async getTeacherAnalytics(tenantId: string, batchId: string, subjectId?: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, tenantId },
      include: {
        enrollments: { include: { candidate: true } },
        academicClass: true,
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const candidateIds = batch.enrollments.map((e) => e.candidateId);

    const [masteries, results] = await Promise.all([
      this.prisma.topicMastery.findMany({
        where: {
          candidateId: { in: candidateIds },
          ...(subjectId ? { subjectId } : {}),
        },
        include: { topic: true, candidate: { include: { user: true } } },
      }),
      this.prisma.examResult.findMany({
        where: { candidateId: { in: candidateIds }, published: true },
        include: { exam: true, candidate: { include: { user: true } } },
      }),
    ]);

    const topicStats = new Map<string, { topic: string; totalAccuracy: number; count: number }>();
    for (const m of masteries) {
      const key = m.topicId;
      const existing = topicStats.get(key) ?? { topic: m.topic.title, totalAccuracy: 0, count: 0 };
      existing.totalAccuracy += m.accuracy;
      existing.count += 1;
      topicStats.set(key, existing);
    }

    const chapterPerformance = [...topicStats.entries()].map(([topicId, stats]) => ({
      topicId,
      topic: stats.topic,
      avgAccuracy: stats.count ? stats.totalAccuracy / stats.count : 0,
      studentCount: stats.count,
    })).sort((a, b) => a.avgAccuracy - b.avgAccuracy);

    const batchAvg = results.length
      ? results.reduce((s, r) => s + r.percentage, 0) / results.length
      : 0;

    return {
      batch: { id: batch.id, name: batch.name, class: batch.academicClass.name },
      studentCount: candidateIds.length,
      batchAverage: batchAvg,
      chapterPerformance,
      recentResults: results.slice(0, 20),
      weakTopics: chapterPerformance.filter((c) => c.avgAccuracy < 50).slice(0, 5),
    };
  }

  async updateMastery(candidateId: string, topicId: string, subjectId: string, isCorrect: boolean) {
    const existing = await this.prisma.topicMastery.findUnique({
      where: { candidateId_topicId: { candidateId, topicId } },
    });

    const attempts = (existing?.attempts ?? 0) + 1;
    const correctCount = (existing?.correctCount ?? 0) + (isCorrect ? 1 : 0);
    const accuracy = (correctCount / attempts) * 100;

    const mastery = await this.prisma.topicMastery.upsert({
      where: { candidateId_topicId: { candidateId, topicId } },
      update: { attempts, correctCount, accuracy, lastAttemptAt: new Date() },
      create: { candidateId, topicId, subjectId, attempts, correctCount, accuracy, lastAttemptAt: new Date() },
    });

    if (accuracy < 50 && attempts >= 3) {
      const existing = await this.prisma.weakAreaRecommendation.findFirst({
        where: { candidateId, topicId, isResolved: false },
      });
      if (!existing) {
        await this.prisma.weakAreaRecommendation.create({
          data: {
            candidateId, topicId,
            reason: `Low accuracy (${accuracy.toFixed(0)}%) on this topic`,
            priority: 3,
          },
        });
      }
    }

    return mastery;
  }

  /**
   * Resolve syllabus topic + subject for a question and update candidate mastery.
   * Uses question.syllabusTopicId, then generated-record source topic/chapter.
   */
  async recordAnswerMastery(candidateId: string, questionId: string, isCorrect: boolean) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        syllabusTopicId: true,
        syllabusTopic: {
          select: {
            id: true,
            chapter: { select: { book: { select: { subjectId: true } } } },
          },
        },
      },
    });
    if (!question) return null;

    let topicId = question.syllabusTopicId;
    let subjectId = question.syllabusTopic?.chapter.book.subjectId;

    if (!topicId || !subjectId) {
      const generated = await this.prisma.generatedQuestionRecord.findFirst({
        where: { questionId },
        select: { sourceTopicId: true, sourceChapterId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (generated?.sourceTopicId) {
        const topic = await this.prisma.syllabusTopic.findUnique({
          where: { id: generated.sourceTopicId },
          select: { id: true, chapter: { select: { book: { select: { subjectId: true } } } } },
        });
        topicId = topic?.id ?? topicId;
        subjectId = topic?.chapter.book.subjectId ?? subjectId;
      } else if (generated?.sourceChapterId) {
        const topic = await this.prisma.syllabusTopic.findFirst({
          where: { chapterId: generated.sourceChapterId },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, chapter: { select: { book: { select: { subjectId: true } } } } },
        });
        topicId = topic?.id ?? topicId;
        subjectId = topic?.chapter.book.subjectId ?? subjectId;
      }
    }

    if (!topicId || !subjectId) return null;
    return this.updateMastery(candidateId, topicId, subjectId, isCorrect);
  }

  async getRecommendations(candidateId: string) {
    return this.prisma.weakAreaRecommendation.findMany({
      where: { candidateId, isResolved: false },
      include: { topic: { include: { chapter: true } } },
      orderBy: { priority: 'desc' },
    });
  }
}
