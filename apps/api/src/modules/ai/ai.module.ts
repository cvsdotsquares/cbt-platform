import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiTestsService } from './ai-tests.service';
import { ProctoringModule } from '../proctoring/proctoring.module';
import { RagModule } from '../rag/rag.module';
import { QuestionsModule } from '../questions/questions.module';
import { ExamsModule } from '../exams/exams.module';

@Module({
  imports: [
    forwardRef(() => ProctoringModule),
    RagModule,
    QuestionsModule,
    ExamsModule,
  ],
  controllers: [AiController],
  providers: [AiService, AiTestsService],
  exports: [AiService, AiTestsService],
})
export class AiModule {}
