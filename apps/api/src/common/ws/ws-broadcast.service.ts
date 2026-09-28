import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class WsBroadcastService {
  private proctoringServer: Server | null = null;
  private examServer: Server | null = null;

  registerProctoring(server: Server) {
    this.proctoringServer = server;
  }

  registerExam(server: Server) {
    this.examServer = server;
  }

  monitoringRoom(tenantId: string) {
    return this.proctoringServer?.to(`tenant:${tenantId}:monitoring`);
  }

  sessionRoom(tenantId: string, sessionId: string) {
    return this.examServer?.to(`tenant:${tenantId}:session:${sessionId}`);
  }

  candidateProctoringRoom(tenantId: string, sessionId: string) {
    return this.proctoringServer?.to(`tenant:${tenantId}:session:${sessionId}`);
  }
}
