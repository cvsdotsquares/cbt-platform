'use client';

/** Frosted glass + drifting waves on the right edge of the institute welcome banner. */
export function WelcomeBannerGlassWaves() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-[min(68%,520px)] [mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.35)_18%,black_72%,black_100%)]"
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-l from-primary/[0.09] via-violet-500/[0.05] to-transparent dark:from-primary/18 dark:via-violet-500/12" />
      <div className="welcome-banner-glass-frost absolute inset-0 backdrop-blur-[4px] dark:backdrop-blur-[5px]" />
      <div className="welcome-banner-glass-shimmer absolute inset-0 opacity-80" />

      <div className="absolute inset-x-0 bottom-0 top-[8%] overflow-hidden">
        <div className="welcome-banner-glass-wave-a absolute inset-x-0 bottom-0 h-full">
          <svg
            className="welcome-banner-glass-wave-svg absolute bottom-0 left-0 h-[108%] w-[240%] max-w-none"
            viewBox="0 0 1200 140"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="welcome-glass-wave-a" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="hsl(239 84% 67% / 0.05)" />
                <stop offset="100%" stopColor="hsl(262 75% 62% / 0.24)" />
              </linearGradient>
            </defs>
            <path
              fill="url(#welcome-glass-wave-a)"
              d="M0,72 C200,120 400,32 600,80 C800,128 1000,48 1200,88 L1200,140 L0,140 Z"
            />
          </svg>
        </div>
        <div className="welcome-banner-glass-wave-b absolute inset-x-0 bottom-0 h-[92%]">
          <svg
            className="welcome-banner-glass-wave-svg absolute bottom-0 left-0 h-[112%] w-[240%] max-w-none"
            viewBox="0 0 1200 140"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="welcome-glass-wave-b" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(239 84% 67% / 0.04)" />
                <stop offset="100%" stopColor="hsl(239 70% 62% / 0.18)" />
              </linearGradient>
            </defs>
            <path
              fill="url(#welcome-glass-wave-b)"
              d="M0,96 C180,56 360,112 540,72 C720,32 900,104 1080,64 C1140,52 1180,68 1200,76 L1200,140 L0,140 Z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
