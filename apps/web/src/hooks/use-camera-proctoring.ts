'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { publishLiveFrame } from '@/lib/proctoring-live-feed';
import { useAuthStore } from '@/stores/auth-store';

interface UseCameraProctoringOptions {
  sessionId: string;
  enabled?: boolean;
  intervalMs?: number;
}

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
      setFaceDetected(true);
    } catch {
      setError('Camera access denied. Proctoring requires webcam permission.');
      setActive(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    let interval: ReturnType<typeof setInterval> | undefined;

    void startCamera().then(() => {
      interval = setInterval(() => {
        const thumbnail = captureFrame();
        if (!thumbnail) return;
        const token = useAuthStore.getState().accessToken;
        if (!token) return;
        void publishLiveFrame(token, sessionId, thumbnail, 'camera');
      }, intervalMs);
    });

    return () => {
      if (interval) clearInterval(interval);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, sessionId, intervalMs, startCamera, captureFrame]);

  return { videoRef, canvasRef, active, error, riskScore, faceDetected, startCamera };
}
