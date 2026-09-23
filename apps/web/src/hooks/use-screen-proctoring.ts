'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { publishLiveFrame } from '@/lib/proctoring-live-feed';
import { useAuthStore } from '@/stores/auth-store';

export type ScreenShareFailureReason = 'denied' | 'wrong_surface' | 'unsupported' | 'insecure_context';

export type ScreenShareStartResult =
  | { ok: true }
  | { ok: false; reason: ScreenShareFailureReason };

interface UseScreenProctoringOptions {
  sessionId: string;
  enabled?: boolean;
  /** Interval between frames sent to proctors (ms). */
  intervalMs?: number;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Browsers often omit displaySurface; only reject explicit app-window shares. */
function isAcceptableDisplaySurface(surface: string | undefined): boolean {
  if (!surface) return true;
  return surface === 'monitor' || surface === 'browser';
}

function insecureContextMessage(): string {
  return (
    'Screen capture is blocked on http:// LAN addresses. Open this exam over https:// on the same host ' +
    '(accept the certificate warning: Advanced → Continue), or use http://localhost on this computer.'
  );
}

export function useScreenProctoring({
  sessionId,
  enabled = true,
  intervalMs = 2000,
}: UseScreenProctoringOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const maxW = 640;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.45);
  }, []);

  const startScreenShare = useCallback(async (): Promise<ScreenShareStartResult> => {
    if (!enabled || !sessionId) return { ok: false, reason: 'unsupported' };

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError(insecureContextMessage());
      setActive(false);
      return { ok: false, reason: 'insecure_context' };
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is not supported in this browser. Use Chrome or Edge.');
      setActive(false);
      return { ok: false, reason: 'unsupported' };
    }

    try {
      const displayOpts = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions;

      const stream = await navigator.mediaDevices.getDisplayMedia(displayOpts);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const surface = settings.displaySurface as string | undefined;

      if (!isAcceptableDisplaySurface(surface)) {
        stopStream(stream);
        setActive(false);
        setError(
          'Share your entire screen or this exam tab — not a single app window.',
        );
        return { ok: false, reason: 'wrong_surface' };
      }

      streamRef.current = stream;
      track.onended = () => {
        setActive(false);
        setError('Screen sharing stopped. Re-enable sharing to continue the proctored exam.');
      };

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            resolve();
            return;
          }
          video.onloadeddata = () => resolve();
        });
      }
      setActive(true);
      setError('');
      const token = useAuthStore.getState().accessToken;
      const thumbnail = captureFrame();
      if (token && thumbnail) {
        void publishLiveFrame(token, sessionId, thumbnail, 'screen');
      }
      return { ok: true };
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      setError(
        denied
          ? 'Screen sharing was blocked or cancelled. You must allow screen capture to take this exam.'
          : 'Could not start screen share. Use Chrome or Edge and allow screen capture.',
      );
      setActive(false);
      return { ok: false, reason: denied ? 'denied' : 'unsupported' };
    }
  }, [enabled, sessionId, captureFrame]);

  useEffect(() => {
    if (!enabled || !sessionId || !active) return;

    const interval = setInterval(() => {
      const thumbnail = captureFrame();
      if (!thumbnail) return;
      const token = useAuthStore.getState().accessToken;
      if (!token) return;
      void publishLiveFrame(token, sessionId, thumbnail, 'screen');
    }, intervalMs);

    return () => clearInterval(interval);
  }, [enabled, sessionId, active, intervalMs, captureFrame]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { videoRef, canvasRef, active, error, startScreenShare };
}
