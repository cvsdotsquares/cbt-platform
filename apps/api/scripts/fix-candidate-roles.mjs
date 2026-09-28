import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const user = await prisma.user.findFirst({
  where: { email: 'candidate@example.com' },
  include: { userRoles: { include: { role: true } } },
});

if (!user) {
  console.error('Candidate user not found');
  process.exit(1);
}

console.log('Before:', user.userRoles.map((r) => r.role.name).join(', '));

const candidateRole = await prisma.role.findUnique({ where: { name: 'CANDIDATE' } });
if (!candidateRole) {
  console.error('CANDIDATE role not found');
  process.exit(1);
}

await prisma.userRole.deleteMany({
  where: { userId: user.id, roleId: { not: candidateRole.id } },
});

const updated = await prisma.user.findFirst({
  where: { id: user.id },
  include: { userRoles: { include: { role: true } } },
});

console.log('After:', updated.userRoles.map((r) => r.role.name).join(', '));
await prisma.$disconnect();
