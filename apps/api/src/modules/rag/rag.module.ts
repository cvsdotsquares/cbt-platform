import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { SyllabusExtractionService } from './syllabus-extraction.service';
import { CurriculumModule } from '../curriculum/curriculum.module';

@Module({
  imports: [CurriculumModule],
  providers: [RagService, SyllabusExtractionService],
  exports: [RagService, SyllabusExtractionService],
})
export class RagModule {}
