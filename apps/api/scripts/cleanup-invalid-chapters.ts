import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { CurriculumService } from '../src/modules/curriculum/curriculum.service';

async function main() {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const curriculum = new CurriculumService(prismaService);

  const books = await prisma.book.findMany({
    where: { subject: { code: 'MATH', academicClass: { level: 10 } } },
    select: { id: true, title: true },
  });

  for (const book of books) {
    const removed = await curriculum.cleanupInvalidChapters(book.id);
    console.log(`Book "${book.title}": removed ${removed} invalid chapter(s)`);
  }

  const chapters = await prisma.chapter.findMany({
    where: { book: { subject: { code: 'MATH', academicClass: { level: 10 } } } },
    orderBy: { number: 'asc' },
    select: { number: true, title: true },
  });
  console.log('\nRemaining Class 10 Math chapters:');
  for (const ch of chapters) {
    console.log(`  Ch.${ch.number}: ${ch.title}`);
  }

  await prisma.$disconnect();
  await prismaService.$disconnect();
}

main().catch(console.error);
