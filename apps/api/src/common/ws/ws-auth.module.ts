import { Module } from '@nestjs/common';
import { AuthModule } from '../../modules/auth/auth.module';
import { WsAuthService } from '../utils/ws-auth.service';
import { WsBroadcastService } from './ws-broadcast.service';

@Module({
  imports: [AuthModule],
  providers: [WsAuthService, WsBroadcastService],
  exports: [WsAuthService, WsBroadcastService],
})
export class WsAuthModule {}
