import {

  WebSocketGateway,

  WebSocketServer,

  SubscribeMessage,

  ConnectedSocket,

  MessageBody,

  OnGatewayConnection,

} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { ExamEngineService } from '../modules/exam-engine/exam-engine.service';

import { WsAuthService } from '../common/utils/ws-auth.service';
import { isOriginAllowed } from '../common/utils/cors-origins';

@WebSocketGateway({
  namespace: '/exam',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
  },
})
export class ExamGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;



  constructor(

    private examEngineService: ExamEngineService,

    private wsAuth: WsAuthService,

  ) {}



  handleConnection(client: Socket) {

    if (!this.wsAuth.authenticate(client)) {

      client.disconnect(true);

    }

  }



  @SubscribeMessage('exam:join')

  async handleJoin(

    @ConnectedSocket() client: Socket,

    @MessageBody() data: { sessionId: string },

  ) {

    const user = this.wsAuth.requireAuth(client);

    if (!user) return;

    await this.examEngineService.assertSessionOwner(data.sessionId, user.sub);

    client.join(`tenant:${user.tenantId}:session:${data.sessionId}`);

    return { event: 'exam:joined', data: { sessionId: data.sessionId } };

  }



  @SubscribeMessage('exam:save-answer')

  async handleSaveAnswer(

    @ConnectedSocket() client: Socket,

    @MessageBody() data: {

      sessionId: string;

      questionId: string;

      answer: unknown;

      timeSpentSeconds: number;

      markedForReview?: boolean;

    },

  ) {

    const user = this.wsAuth.requireAuth(client);

    if (!user) return;

    await this.examEngineService.saveAnswer(

      data.sessionId,

      user.sub,

      data.questionId,

      data.answer,

      data.timeSpentSeconds,

      data.markedForReview,

    );

    return { event: 'exam:answer-saved', data: { questionId: data.questionId, savedAt: new Date() } };

  }



  @SubscribeMessage('exam:heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      sessionId: string;
      answers?: {
        questionId: string;
        answer: unknown;
        timeSpentSeconds?: number;
        markedForReview?: boolean;
      }[];
    },
  ) {
    const user = this.wsAuth.requireAuth(client);
    if (!user) return;
    return {
      event: 'exam:heartbeat-ack',
      data: await this.examEngineService.heartbeat(data.sessionId, user.sub, data.answers),
    };
  }



  @SubscribeMessage('exam:submit')
  async handleSubmit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      sessionId: string;
      answers?: {
        questionId: string;
        answer: unknown;
        timeSpentSeconds?: number;
        markedForReview?: boolean;
      }[];
    },
  ) {
    const user = this.wsAuth.requireAuth(client);
    if (!user) return;
    const result = await this.examEngineService.submitSession(data.sessionId, user.sub, data.answers);
    return {
      event: 'exam:submitted',
      data: {
        sessionId: data.sessionId,
        submittedAt: result.session.submittedAt,
        result: result.result,
      },
    };
  }

}


