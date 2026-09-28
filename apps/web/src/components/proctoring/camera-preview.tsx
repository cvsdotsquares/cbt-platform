'use client';

import { RefObject } from 'react';
import { Badge } from '@/components/ui/badge';
import { Camera, CameraOff, Shield } from 'lucide-react';

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  active: boolean;
  error?: string;
  riskScore: number;
  faceDetected: boolean;
}

export function CameraPreview({ videoRef, canvasRef, active, error, riskScore, faceDetected }: CameraPreviewProps) {
  return (
    <>
    <canvas ref={canvasRef} className="hidden" />
    <div className="fixed bottom-4 left-4 z-40 w-28 overflow-hidden rounded-xl border-2 border-primary/30 bg-card shadow-card-hover sm:left-auto sm:right-4 sm:w-40 md:w-48">
      <div className="relative aspect-[4/3] bg-black">
        <video ref={videoRef} className="h-full w-full object-cover mirror" muted playsInline style={{ transform: 'scaleX(-1)' }} />
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <CameraOff className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <Badge variant={active ? 'success' : 'destructive'} className="gap-1 text-[10px]">
            <Camera className="h-3 w-3" /> {active ? 'LIVE' : 'OFF'}
          </Badge>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
          <div className="flex items-center justify-between text-[10px] text-white">
            <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> AI Proctor</span>
            <span className={riskScore > 70 ? 'text-red-400' : riskScore > 40 ? 'text-yellow-400' : 'text-green-400'}>
              Risk {Math.round(riskScore)}
            </span>
          </div>
          {!faceDetected && active && <p className="text-[9px] text-red-400">Face not detected</p>}
        </div>
      </div>
      {error && <p className="p-2 text-[10px] text-destructive">{error}</p>}
    </div>
    </>
  );
}
