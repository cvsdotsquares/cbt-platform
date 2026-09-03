'use client';

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import { disconnectExamSocket, getExamSocket } from '@/lib/socket';

type SaveAnswerPayload = {
  sessionId: string;
  questionId: string;
  answer: unknown;
  timeSpentSeconds: number;
  markedForReview?: boolean;
};

type PendingAnswer = {
  questionId: string;
  answer: unknown;
  timeSpentSeconds?: number;
  markedForReview?: boolean;
};

type HeartbeatResult = {
  timeRemainingSeconds: number;
  autoSubmitted: boolean;
  result?: { totalScore: number; maxScore: number; percentage: number };
};

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 8000);
    socket.emit(event, payload, (response: { event?: string; data?: T } | undefined) => {
      clearTimeout(timeout);
      if (response?.data !== undefined) resolve(response.data);
      else reject(new Error('WebSocket request failed'));
    });
  });
}

export function useExamSocket(sessionId: string | null, enabled: boolean) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!sessionId || !enabled) return;

    const socket = getExamSocket();
    if (!socket) return;
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('exam:join', { sessionId });
    };

    const onDisconnect = () => setConnected(false);

    socket.connect();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      disconnectExamSocket();
      setConnected(false);
    };
  }, [sessionId, enabled]);

  const saveAnswer = useCallback(
    async (payload: SaveAnswerPayload) => {
      const socket = socketRef.current;
      if (!socket?.connected) throw new Error('Exam socket not connected');
      return emitAck<{ questionId: string; savedAt: string }>(socket, 'exam:save-answer', payload);
    },
    [],
  );

  const heartbeat = useCallback(async (sid: string, answers?: PendingAnswer[]) => {
    const socket = socketRef.current;
    if (!socket?.connected) throw new Error('Exam socket not connected');
    return emitAck<HeartbeatResult>(socket, 'exam:heartbeat', { sessionId: sid, answers });
  }, []);

  const submit = useCallback(async (sid: string, answers?: PendingAnswer[]) => {
    const socket = socketRef.current;
    if (!socket?.connected) throw new Error('Exam socket not connected');
    return emitAck<{ sessionId: string; submittedAt: string; result?: HeartbeatResult['result'] }>(
      socket,
      'exam:submit',
      { sessionId: sid, answers },
    );
  }, []);

  return useMemo(
    () => ({ connected, saveAnswer, heartbeat, submit }),
    [connected, saveAnswer, heartbeat, submit],
  );
}
