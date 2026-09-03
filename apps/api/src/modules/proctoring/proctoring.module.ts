import { Module, forwardRef } from '@nestjs/common';
import { ProctoringController } from './proctoring.controller';
import { ProctoringService } from './proctoring.service';
import { ProctoringGateway } from '../../gateways/proctoring.gateway';
import { AiModule } from '../ai/ai.module';
import { WsAuthModule } from '../../common/ws/ws-auth.module';

@Module({
  imports: [forwardRef(() => AiModule), WsAuthModule],
  controllers: [ProctoringController],
  providers: [ProctoringService, ProctoringGateway],
  exports: [ProctoringService],
})
export class ProctoringModule {}
