import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { JwtPayload } from '@cbt/shared';

@Injectable()
export class WsAuthService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  authenticate(client: Socket): JwtPayload | null {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) return null;
    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      client.data.user = payload;
      return payload;
    } catch {
      return null;
    }
  }

  requireAuth(client: Socket): JwtPayload | null {
    const user = (client.data.user as JwtPayload) || this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return null;
    }
    return user;
  }
}
