import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Role, Permission, ROLE_PERMISSIONS } from '@cbt/shared';
import { seedNcertCurriculum, seedDemoBatch } from './ncert-seed';

const prisma = new PrismaClient();

async function syncUserRoles(userId: string, expectedRoleNames: Role[]) {
  const roles = await prisma.role.findMany({
    where: { name: { in: expectedRoleNames } },
  });
  const roleIds = roles.map((role) => role.id);

  await prisma.userRole.deleteMany({
    where: {
      userId,
      roleId: { notIn: roleIds },
    },
  });

  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
  }
}

async function main() {
  console.log('Seeding database...');

  const seedDemoUsers =
    process.env.SEED_DEMO_USERS === 'true' || process.env.NODE_ENV !== 'production';

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: 'Default Organization',
      slug: 'default',
      branding: { primaryColor: '#2563eb', logo: '/logo.png', theme: 'light' },
      securityConfig: { mfaRequired: false, passwordPolicy: { minLength: 8, requireSpecialChar: true } },
    },
  });

  for (const code of Object.values(Permission)) {
    const [module, action] = code.split(':');
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, module, action, description: `${action} ${module}` },
    });
  }

  for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName.replace(/_/g, ' ')} role`, isSystem: true },
    });
    for (const permCode of permissions) {
      const permission = await prisma.permission.findUnique({ where: { code: permCode } });
      if (permission) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
  }

  const superAdminRole = await prisma.role.findUnique({ where: { name: Role.SUPER_ADMIN } });
  const candidateRole = await prisma.role.findUnique({ where: { name: Role.CANDIDATE } });

  let admin = { id: '' };
  let candidate = { id: '' };
  let teacherUser = { id: '' };
  let exam = { code: 'DEMO-2026', title: 'Demo Aptitude Test 2026' };

  if (seedDemoUsers) {
  const adminRecord = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@cbt-platform.com' } },
    update: { status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      email: 'admin@cbt-platform.com',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      firstName: 'Super',
      lastName: 'Admin',
      status: 'ACTIVE',
      emailVerified: true,
      userRoles: superAdminRole ? { create: { roleId: superAdminRole.id } } : undefined,
    },
  });
  admin = adminRecord;

  await syncUserRoles(admin.id, [Role.SUPER_ADMIN]);

  const candidateUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'candidate@example.com' } },
    update: { status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      email: 'candidate@example.com',
      passwordHash: await bcrypt.hash('Candidate@123', 12),
      firstName: 'Test',
      lastName: 'Candidate',
      status: 'ACTIVE',
      emailVerified: true,
      userRoles: candidateRole ? { create: { roleId: candidateRole.id } } : undefined,
    },
  });

  await syncUserRoles(candidateUser.id, [Role.STUDENT, Role.CANDIDATE]);

  const teacherRole = await prisma.role.findUnique({ where: { name: Role.TEACHER } });
  teacherUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'teacher@example.com' } },
    update: { status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      email: 'teacher@example.com',
      passwordHash: await bcrypt.hash('Teacher@123', 12),
      firstName: 'Demo',
      lastName: 'Teacher',
      status: 'ACTIVE',
      emailVerified: true,
      userRoles: teacherRole ? { create: { roleId: teacherRole.id } } : undefined,
    },
  });
  await syncUserRoles(teacherUser.id, [Role.TEACHER]);

  const candidateRecord = await prisma.candidate.upsert({
    where: { userId: candidateUser.id },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: candidateUser.id,
      registrationNumber: 'CAND-2026-00001',
      kycStatus: 'VERIFIED',
      kycVerifiedAt: new Date(),
    },
  });
  candidate = candidateRecord;

  let topic = await prisma.topic.findFirst({ where: { tenantId: tenant.id, name: 'General Aptitude' } });
  if (!topic) {
    topic = await prisma.topic.create({
      data: { tenantId: tenant.id, name: 'General Aptitude', description: 'General aptitude questions' },
    });
  }

  const questionData = [
    {
      title: 'Ratio of Ages',
      content: 'If the ratio of ages of A and B is 3:5 and sum is 48, what is age of A?',
      options: { a: '16', b: '18', c: '20', d: '24' },
      answer: 'b',
    },
    {
      title: 'Simple Interest',
      content: 'What is the SI on Rs. 5000 at 10% per annum for 2 years?',
      options: { a: '500', b: '1000', c: '1500', d: '2000' },
      answer: 'b',
    },
    {
      title: 'Capital City',
      content: 'What is the capital of India?',
      options: { a: 'Mumbai', b: 'Kolkata', c: 'New Delhi', d: 'Chennai' },
      answer: 'c',
    },
    {
      title: 'Binary Conversion',
      content: 'What is decimal 5 in binary?',
      options: { a: '100', b: '101', c: '110', d: '111' },
      answer: 'b',
    },
    {
      title: 'Speed Problem',
      content: 'A car travels 120 km in 2 hours. What is its speed?',
      options: { a: '40 km/h', b: '50 km/h', c: '60 km/h', d: '70 km/h' },
      answer: 'c',
    },
  ];

  const questionIds: string[] = [];
  for (const q of questionData) {
    const existing = await prisma.question.findFirst({ where: { tenantId: tenant.id, title: q.title } });
    if (existing) {
      questionIds.push(existing.id);
      continue;
    }
    const question = await prisma.question.create({
      data: {
        tenantId: tenant.id,
        type: 'MCQ',
        difficulty: 'MEDIUM',
        topicId: topic.id,
        title: q.title,
        status: 'APPROVED',
        createdById: admin.id,
        versions: {
          create: {
            versionNumber: 1,
            content: { text: q.content },
            options: q.options,
            correctAnswer: { value: q.answer },
            marks: 2,
            negativeMarks: 0,
            approvedById: admin.id,
            approvedAt: new Date(),
          },
        },
      },
      include: { versions: true },
    });
    await prisma.question.update({
      where: { id: question.id },
      data: { currentVersionId: question.versions[0].id },
    });
    questionIds.push(question.id);
  }

  const startTime = new Date();
  startTime.setHours(startTime.getHours() - 1);
  const endTime = new Date();
  endTime.setDate(endTime.getDate() + 30);

  let demoExam = await prisma.exam.findFirst({
    where: { tenantId: tenant.id, code: 'DEMO-2026' },
    include: { sections: true },
  });
  if (!demoExam) {
    demoExam = await prisma.exam.create({
      data: {
        tenantId: tenant.id,
        title: 'Demo Aptitude Test 2026',
        code: 'DEMO-2026',
        type: 'RECRUITMENT',
        status: 'PUBLISHED',
        startTime,
        endTime,
        timezone: 'Asia/Kolkata',
        settings: {
          durationMinutes: 30,
          passingScore: 40,
          negativeMarking: false,
          shuffleQuestions: false,
          showResultImmediately: true,
        },
        securityPolicy: {
          proctoringEnabled: true,
          fullscreen: true,
          blockCopyPaste: true,
          blockRightClick: true,
          detectDevTools: true,
          watermark: { enabled: true, content: 'email', opacity: 0.06 },
        },
        createdById: admin.id,
        publishedAt: new Date(),
        sections: {
          create: [{ name: 'Section A - General', orderIndex: 1, durationMinutes: 30, negativeMarking: false }],
        },
      },
      include: { sections: true },
    });

    const sectionId = demoExam.sections[0].id;
    await prisma.examQuestion.createMany({
      data: questionIds.map((questionId, i) => ({
        examId: demoExam!.id,
        sectionId,
        questionId,
        orderIndex: i + 1,
      })),
    });

    await prisma.examRegistration.create({
      data: { examId: demoExam.id, candidateId: candidate.id, status: 'REGISTERED' },
    });
  }
  exam = demoExam;
  }

  await seedNcertCurriculum(prisma, tenant.id);
  if (seedDemoUsers && candidate.id) {
    const demoBatch = await seedDemoBatch(prisma, tenant.id, candidate.id);
    const class10 = await prisma.academicClass.findFirst({ where: { level: 10 } });
    const science = class10
      ? await prisma.subject.findFirst({ where: { academicClassId: class10.id, code: 'SCI' } })
      : null;
    if (demoBatch && science) {
      await prisma.teacherAssignment.upsert({
        where: {
          userId_batchId_subjectId: {
            userId: teacherUser.id,
            batchId: demoBatch.id,
            subjectId: science.id,
          },
        },
        update: {},
        create: {
          userId: teacherUser.id,
          batchId: demoBatch.id,
          subjectId: science.id,
        },
      });
    }
  }

  console.log('Seed completed successfully');
  if (seedDemoUsers) {
    console.log('Admin: admin@cbt-platform.com / Admin@123');
    console.log('Teacher: teacher@example.com / Teacher@123');
    console.log('Student: candidate@example.com / Candidate@123');
    console.log(`Demo exam: ${exam.code} (${exam.title})`);
  } else {
    console.log('Demo users skipped (set SEED_DEMO_USERS=true to create them)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
