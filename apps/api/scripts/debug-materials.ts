import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { extractPdfText } from '../src/modules/rag/pdf-text-extractor';
import { SyllabusExtractionService } from '../src/modules/rag/syllabus-extraction.service';
import { ConfigService } from '@nestjs/config';
import { looksLikeSingleChapterPdf } from '../src/modules/rag/ncert-text-utils';

async function main() {
  const prisma = new PrismaClient();
  const materials = await prisma.studyMaterial.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      chapter: true,
      subject: true,
      academicClass: true,
    },
  });

  console.log('Materials:', materials.length);
  for (const m of materials) {
    console.log('\n---', m.title, '---');
    console.log({ id: m.id, fileName: m.fileName, isFullBook: m.isFullBook, status: m.status, chapter: m.chapter });
  }

  const config = new ConfigService();
  const extraction = new SyllabusExtractionService(config);

  for (const m of materials.filter((x) => x.mimeType?.includes('pdf') || x.fileName.endsWith('.pdf')).slice(0, 5)) {
    try {
      const buffer = await fs.readFile(m.fileUrl);
      const layout = await extractPdfText(buffer);
      console.log('\n=== EXTRACT:', m.title, '===');
      console.log('Headings (first 15):', layout.headings.slice(0, 15));
      console.log('Opening lines:', layout.text.split('\n').slice(0, 25).join(' | '));

      const singleChapter = !m.isFullBook || looksLikeSingleChapterPdf(m.fileName, layout.text);
      console.log('singleChapter mode:', singleChapter);

      const result = await extraction.extractFromText(layout.text, {
        singleChapter,
        fallbackTitle: m.title,
        subjectName: m.subject?.name,
        classLevel: m.academicClass?.level,
        pdfLayout: layout,
      });
      console.log('Extracted:', result.map((c) => `Ch${c.number}: "${c.title}"`).join('; '));
    } catch (e) {
      console.error('Failed', m.title, e);
    }
  }

  const chapters = await prisma.chapter.findMany({
    where: { book: { subject: { name: { contains: 'Math', mode: 'insensitive' } } } },
    orderBy: { number: 'asc' },
    take: 30,
    include: { book: { include: { subject: { include: { academicClass: true } } } } },
  });
  console.log('\n=== Math chapters in DB ===');
  for (const ch of chapters) {
    console.log(`Ch.${ch.number}: ${ch.title} (class ${ch.book.subject.academicClass.level})`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
