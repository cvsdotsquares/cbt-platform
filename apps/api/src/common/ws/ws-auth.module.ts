import { Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { WsAuthService } from '../utils/ws-auth.service';

@Module({
  imports: [AuthModule],
  providers: [WsAuthService],
  exports: [WsAuthService],
})
export class WsAuthModule {}
