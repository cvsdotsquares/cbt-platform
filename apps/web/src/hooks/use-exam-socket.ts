'use client';

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import { connectExamSocket, disconnectExamSocket } from '@/lib/socket';

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
  paused?: boolean;
  terminated?: boolean;
  result?: { totalScore: number; maxScore: number; percentage: number };
};

export type ProctorExamState = {
  paused: boolean;
  terminated: boolean;
  message: string;
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
  const [proctorState, setProctorState] = useState<ProctorExamState>({
    paused: false,
    terminated: false,
    message: '',
  });

  useEffect(() => {
    if (!sessionId || !enabled) return;

    let cancelled = false;
    let detachListeners: (() => void) | undefined;

    void connectExamSocket().then((socket) => {
      if (cancelled || !socket) return;
      socketRef.current = socket;

      const onConnect = () => {
        setConnected(true);
        socket.emit('exam:join', { sessionId });
      };

      const onDisconnect = () => setConnected(false);

      const onPaused = (data: { message?: string }) => {
        setProctorState({ paused: true, terminated: false, message: data.message || 'Exam paused by proctor' });
      };

      const onResumed = () => {
        setProctorState({ paused: false, terminated: false, message: '' });
      };

      const onTerminated = (data: { message?: string }) => {
        setProctorState({
          paused: false,
          terminated: true,
          message: data.message || 'Session terminated by proctor',
        });
      };

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('exam:paused', onPaused);
      socket.on('exam:resumed', onResumed);
      socket.on('exam:terminated', onTerminated);
      if (socket.connected) onConnect();

      detachListeners = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('exam:paused', onPaused);
        socket.off('exam:resumed', onResumed);
        socket.off('exam:terminated', onTerminated);
      };
    });

    return () => {
      cancelled = true;
      detachListeners?.();
      disconnectExamSocket();
      socketRef.current = null;
      setConnected(false);
      setProctorState({ paused: false, terminated: false, message: '' });
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
    () => ({ connected, saveAnswer, heartbeat, submit, proctorState }),
    [connected, saveAnswer, heartbeat, submit, proctorState],
  );
}
