import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const teacher = await prisma.user.findFirst({ where: { email: 'teacher@example.com' } });
  const batchNames = ['Batch A - Class X', 'Batch B - Class X'];

  if (!teacher) {
    console.error('Teacher not found');
    process.exitCode = 1;
    return;
  }

  for (const name of batchNames) {
    const batch = await prisma.batch.findFirst({ where: { name } });
    if (!batch) {
      console.log('Skip missing batch', name);
      continue;
    }
    const subject =
      (await prisma.subject.findFirst({ where: { academicClassId: batch.academicClassId, code: 'SCI' } }))
      ?? (await prisma.subject.findFirst({ where: { academicClassId: batch.academicClassId } }));
    if (!subject) {
      console.log('Skip — no subject for', name);
      continue;
    }
    const assignment = await prisma.teacherAssignment.upsert({
      where: {
        userId_batchId_subjectId: {
          userId: teacher.id,
          batchId: batch.id,
          subjectId: subject.id,
        },
      },
      update: {},
      create: {
        userId: teacher.id,
        batchId: batch.id,
        subjectId: subject.id,
      },
    });
    console.log(`OK ${name} / ${subject.name} -> ${assignment.id}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
