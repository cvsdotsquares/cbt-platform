import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { LearningModule } from '../learning/learning.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [LearningModule, AiModule],
  controllers: [ResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
