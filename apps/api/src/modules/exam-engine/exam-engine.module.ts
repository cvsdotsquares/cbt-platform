import { Module, forwardRef } from '@nestjs/common';
import { ExamEngineController } from './exam-engine.controller';
import { ExamEngineService } from './exam-engine.service';
import { ExamGateway } from '../../gateways/exam.gateway';
import { ResultsModule } from '../results/results.module';
import { WsAuthModule } from '../../common/ws/ws-auth.module';

@Module({
  imports: [forwardRef(() => ResultsModule), WsAuthModule],
  controllers: [ExamEngineController],
  providers: [ExamEngineService, ExamGateway],
  exports: [ExamEngineService],
})
export class ExamEngineModule {}
