import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export async function resolveCandidateId(prisma: PrismaService, userId: string): Promise<string> {
  const candidate = await prisma.candidate.findUnique({ where: { userId } });
  if (!candidate) {
    throw new BadRequestException('Candidate profile not found. Please complete registration.');
  }
  return candidate.id;
}
