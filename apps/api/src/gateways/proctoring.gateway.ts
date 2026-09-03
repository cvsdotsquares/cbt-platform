import {

  WebSocketGateway,

  WebSocketServer,

  SubscribeMessage,

  ConnectedSocket,

  MessageBody,

  OnGatewayConnection,

} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { ProctoringService } from '../modules/proctoring/proctoring.service';

import { AiService } from '../modules/ai/ai.service';

import { PrismaService } from '../prisma/prisma.service';

import { WsAuthService } from '../common/utils/ws-auth.service';
import { isOriginAllowed } from '../common/utils/cors-origins';
import { Permission } from '@cbt/shared';

@WebSocketGateway({
  namespace: '/proctoring',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
  },
})

export class ProctoringGateway implements OnGatewayConnection {

  @WebSocketServer()

  server!: Server;



  constructor(

    private proctoringService: ProctoringService,

    private aiService: AiService,

    private prisma: PrismaService,

    private wsAuth: WsAuthService,

  ) {}



  handleConnection(client: Socket) {

    if (!this.wsAuth.authenticate(client)) {

      client.disconnect(true);

    }

  }



  @SubscribeMessage('proctoring:join-monitoring')

  handleJoinMonitoring(@ConnectedSocket() client: Socket) {

    const user = this.wsAuth.requireAuth(client);

    if (!user) return;

    if (!user.permissions?.includes(Permission.PROCTORING_MONITOR)) {

      return { event: 'proctoring:error', data: { message: 'Insufficient permissions' } };

    }

    client.join(`tenant:${user.tenantId}:monitoring`);

    return { event: 'proctoring:joined', data: { room: `tenant:${user.tenantId}:monitoring` } };

  }



  @SubscribeMessage('proctoring:frame')

  async handleFrame(

    @ConnectedSocket() client: Socket,

    @MessageBody() data: { sessionId: string; thumbnail: string; metadata?: Record<string, unknown> },

  ) {

    const user = this.wsAuth.requireAuth(client);

    if (!user) return;



    const session = await this.prisma.examSession.findUnique({

      where: { id: data.sessionId },

      include: { exam: { select: { tenantId: true } }, candidate: { select: { userId: true } } },

    });

    if (!session || session.candidate.userId !== user.sub) {

      return { event: 'proctoring:error', data: { message: 'Invalid session' } };

    }



    const analysis = await this.aiService.processProctoringFrame(data.sessionId, data.thumbnail);

    const tenantId = session.exam.tenantId;



    this.server.to(`tenant:${tenantId}:monitoring`).emit('proctoring:risk-update', {

      sessionId: data.sessionId,

      riskScore: analysis.riskScore,

      faceDetected: analysis.faceDetected,

      violations: analysis.violations,

      timestamp: new Date().toISOString(),

    });



    return {

      event: 'proctoring:status',

      data: { riskScore: analysis.riskScore, faceDetected: analysis.faceDetected, timestamp: new Date().toISOString() },

    };

  }



  @SubscribeMessage('proctoring:browser-event')

  async handleBrowserEvent(

    @ConnectedSocket() client: Socket,

    @MessageBody() data: { sessionId: string; type: string; metadata?: Record<string, unknown> },

  ) {

    const user = this.wsAuth.requireAuth(client);

    if (!user) return;



    const session = await this.prisma.examSession.findUnique({

      where: { id: data.sessionId },

      include: { candidate: { select: { userId: true } }, exam: { select: { tenantId: true } } },

    });

    if (!session || session.candidate.userId !== user.sub) {

      return { event: 'proctoring:error', data: { message: 'Invalid session' } };

    }



    const severityMap: Record<string, string> = {

      TAB_SWITCH: 'MEDIUM',

      COPY_ATTEMPT: 'HIGH',

      DEVTOOLS: 'HIGH',

      MULTIPLE_FACES: 'CRITICAL',

      NO_FACE: 'HIGH',

    };



    const event = await this.proctoringService.recordEvent(

      data.sessionId,

      data.type as never,

      { severity: (severityMap[data.type] || 'LOW') as never, metadata: data.metadata },

    );



    if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {

      this.server.to(`tenant:${session.exam.tenantId}:monitoring`).emit('proctoring:violation', {

        sessionId: data.sessionId,

        type: data.type,

        severity: event.severity,

        timestamp: new Date().toISOString(),

      });

    }



    return { event: 'proctoring:event-recorded', data: { id: event.id } };

  }

}


