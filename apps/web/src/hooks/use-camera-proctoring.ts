'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getProctoringSocket } from '@/lib/socket';

interface UseCameraProctoringOptions {
  sessionId: string;
  enabled?: boolean;
  intervalMs?: number;
}

type ProctoringStatus = { riskScore: number; faceDetected?: boolean };

export function useCameraProctoring({ sessionId, enabled = true, intervalMs = 3000 }: UseCameraProctoringOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const [riskScore, setRiskScore] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 320, 240);
    return canvas.toDataURL('image/jpeg', 0.6);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setError('');
    } catch {
      setError('Camera access denied. Proctoring requires webcam permission.');
      setActive(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    startCamera();
    const socket = getProctoringSocket();
    if (!socket) return;
    socket.connect();

    const interval = setInterval(() => {
      const thumbnail = captureFrame();
      if (!thumbnail || !socket.connected) return;

      socket.emit(
        'proctoring:frame',
        { sessionId, thumbnail, metadata: { ts: Date.now() } },
        (response: { event?: string; data?: ProctoringStatus } | undefined) => {
          if (response?.event === 'proctoring:status' && response.data) {
            setRiskScore(response.data.riskScore);
            if (response.data.faceDetected !== undefined) {
              setFaceDetected(response.data.faceDetected);
            }
          }
        },
      );
    }, intervalMs);

    return () => {
      clearInterval(interval);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, sessionId, intervalMs, startCamera, captureFrame]);

  return { videoRef, canvasRef, active, error, riskScore, faceDetected, startCamera };
}
