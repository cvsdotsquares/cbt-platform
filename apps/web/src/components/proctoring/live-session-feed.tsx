'use client';

export type LiveFeedState = 'live' | 'waiting' | 'offline';

interface LiveSessionFeedProps {
  screenThumbnail?: string;
  cameraThumbnail?: string;
  feedState?: LiveFeedState;
  /** When false, exam policy disables screen/webcam feed (integrity events may still apply). */
  screenFeedEnabled?: boolean;
}

export function LiveSessionFeed({
  screenThumbnail,
  cameraThumbnail,
  feedState = 'waiting',
  screenFeedEnabled = true,
}: LiveSessionFeedProps) {
  const preview = screenThumbnail || cameraThumbnail;
  const showLive = !!preview && feedState !== 'offline';

  const placeholder =
    !screenFeedEnabled
      ? {
          title: 'Screen feed not enabled',
          detail:
            'This test only logs browser integrity events (tab switch, fullscreen). Enable proctoring on the exam to require screen sharing.',
        }
      : feedState === 'offline'
        ? {
            title: 'Candidate offline',
            detail: 'No heartbeat or screen feed. Session may auto-close after 3 minutes idle.',
          }
        : {
            title: 'Waiting for screen feed…',
            detail: 'Candidate must tap “Start Screen Recording” on the exam and share this tab.',
          };

  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-lg border bg-black/90">
        {showLive ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Live exam screen" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 px-3 text-center text-xs text-muted-foreground">
            <span>{placeholder.title}</span>
            <span className="text-[10px] opacity-80">{placeholder.detail}</span>
          </div>
        )}
        {screenThumbnail && showLive && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            Screen
          </span>
        )}
        {!screenThumbnail && cameraThumbnail && showLive && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            Webcam
          </span>
        )}
        {cameraThumbnail && screenThumbnail && showLive && (
          <div className="absolute bottom-2 right-2 w-16 overflow-hidden rounded border border-white/30 sm:w-20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cameraThumbnail} alt="Webcam" className="aspect-[4/3] w-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}
