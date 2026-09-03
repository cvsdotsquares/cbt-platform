import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  async getSetupStatus(tenantId: string) {
    const [
      classCount,
      batchCount,
      materialReady,
      materialTotal,
      enrollmentCount,
      progressCompleted,
      aiTestCount,
      studentCount,
    ] = await Promise.all([
      this.prisma.academicClass.count({ where: { OR: [{ tenantId }, { tenantId: null }] } }),
      this.prisma.batch.count({ where: { tenantId } }),
      this.prisma.studyMaterial.count({ where: { tenantId, status: 'READY' } }),
      this.prisma.studyMaterial.count({ where: { tenantId } }),
      this.prisma.batchEnrollment.count({ where: { batch: { tenantId } } }),
      this.prisma.syllabusProgress.count({ where: { batch: { tenantId }, status: 'COMPLETED' } }),
      this.prisma.aiTestConfig.count({ where: { tenantId } }),
      this.prisma.candidate.count({ where: { tenantId } }),
    ]);

    const steps = [
      {
        id: 'syllabus',
        order: 1,
        title: 'Review extracted syllabus',
        description: 'Chapters and topics from your uploaded books. Open Syllabus after uploading.',
        href: '/dashboard/syllabus',
        done: materialReady > 0,
        detail: materialReady > 0 ? `${materialReady} book(s) indexed` : 'Upload books first',
      },
      {
        id: 'students',
        order: 2,
        title: 'Add Students',
        description: 'Create student accounts under Students. Each student needs a login.',
        href: '/dashboard/candidates',
        done: studentCount > 0,
        detail: `${studentCount} student(s)`,
      },
      {
        id: 'batch',
        order: 3,
        title: 'Create a Batch',
        description: 'Group students by class and academic year (e.g. Class 10 — Batch A — 2025-26).',
        href: '/dashboard/batches',
        done: batchCount > 0,
        detail: `${batchCount} batch(es)`,
      },
      {
        id: 'enroll',
        order: 4,
        title: 'Enroll Students in Batch',
        description: 'On the Batches page, select a batch and enroll students with roll numbers.',
        href: '/dashboard/batches',
        done: enrollmentCount > 0,
        detail: `${enrollmentCount} enrollment(s)`,
      },
      {
        id: 'materials',
        order: 5,
        title: 'Upload Study Materials',
        description: 'Upload PDFs or notes. Chapters, topics, and AI index are built from your files.',
        href: '/dashboard/materials',
        done: materialReady > 0,
        detail: materialTotal > 0 ? `${materialReady}/${materialTotal} indexed` : 'No uploads yet',
      },
      {
        id: 'syllabus-progress',
        order: 6,
        title: 'Mark Syllabus Progress',
        description: 'Mark chapters as Completed (✅) or In Progress (🔄). AI only uses completed chapters.',
        href: '/dashboard/batches',
        done: progressCompleted > 0,
        detail: `${progressCompleted} chapter(s) completed`,
      },
      {
        id: 'ai-test',
        order: 7,
        title: 'Create NCERT Class Test',
        description: 'Use Create Class Test: pick batch + subject → generate from studied chapters → publish on Class Tests.',
        href: '/dashboard/ai-tests',
        done: aiTestCount > 0,
        detail: `${aiTestCount} AI test(s) created`,
      },
      {
        id: 'student-take',
        order: 8,
        title: 'Student Takes Class Test',
        description: 'Student logs in → Student Portal → Class Tests → Start.',
        href: '/my-exams',
        done: aiTestCount > 0 && enrollmentCount > 0,
        detail: 'Student: candidate@example.com / Candidate@123',
      },
    ];

    const completed = steps.filter((s) => s.done).length;
    const nextStep = steps.find((s) => !s.done);

    return {
      progress: Math.round((completed / steps.length) * 100),
      completed,
      total: steps.length,
      nextStep,
      steps,
      demoAccounts: {
        admin: { email: 'admin@cbt-platform.com', password: 'Admin@123' },
        teacher: { email: 'teacher@example.com', password: 'Teacher@123' },
        student: { email: 'candidate@example.com', password: 'Candidate@123' },
      },
    };
  }
}
