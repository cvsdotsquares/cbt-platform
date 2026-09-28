import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { RagService } from '../src/modules/rag/rag.service';
import { CurriculumService } from '../src/modules/curriculum/curriculum.service';
import { SyllabusExtractionService } from '../src/modules/rag/syllabus-extraction.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const config = new ConfigService();
  const curriculum = new CurriculumService(prismaService);
  const syllabus = new SyllabusExtractionService(config);
  const rag = new RagService(prismaService, config, curriculum, syllabus);

  const ids = [
    'a10b4b0c-f7a6-4eb4-b80a-3a3a504b8fa9', // chapter-1
    'e296e007-ae02-4488-940e-a57fc694ee96', // chapter-2
    '6bc949c6-3e89-478f-b6db-c185936a0512', // chapter-3
  ];

  for (const id of ids) {
    console.log(`Reindexing ${id}...`);
    const result = await rag.indexMaterial(id);
    console.log('  ->', result);
  }

  const class10Math = await prisma.chapter.findMany({
    where: { book: { subject: { code: 'MATH', academicClass: { level: 10 } } } },
    orderBy: { number: 'asc' },
    select: { number: true, title: true },
  });
  console.log('\nClass 10 Math chapters after reindex:');
  for (const ch of class10Math) {
    console.log(`  Ch.${ch.number}: ${ch.title}`);
  }

  await prisma.$disconnect();
  await prismaService.$disconnect();
}

main().catch(console.error);
