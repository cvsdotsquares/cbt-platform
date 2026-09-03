import type { ExamSecurityPolicy } from '@cbt/shared';

type RawSecurityPolicy = Partial<ExamSecurityPolicy> & {
  fullscreenRequired?: boolean;
};

/** Browser fullscreen element (standard + webkit). */
export function getFullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreenActive(): boolean {
  return !!getFullscreenElement();
}

function setExamFullscreenClass(active: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('exam-fullscreen-active', active);
}

export function syncExamFullscreenClass(): void {
  setExamFullscreenClass(isFullscreenActive());
}

export function normalizeSecurityPolicy(
  raw?: RawSecurityPolicy | null,
): ExamSecurityPolicy {
  const defaults: ExamSecurityPolicy = {
    fullscreen: true,
    blockCopyPaste: true,
    blockRightClick: true,
    blockPrint: true,
    detectDevTools: true,
    detectScreenCapture: true,
    detectVirtualMachine: false,
    detectVpn: false,
    watermark: { enabled: false, content: 'email', opacity: 0.06 },
    allowedBrowsers: [],
    proctoringEnabled: true,
    faceVerificationRequired: false,
    riskScoreThreshold: 70,
  };

  if (!raw) return defaults;

  const fullscreen = raw.fullscreen !== undefined
    ? raw.fullscreen
    : raw.fullscreenRequired !== undefined
      ? raw.fullscreenRequired
      : defaults.fullscreen;

  return {
    ...defaults,
    ...raw,
    fullscreen,
    watermark: { ...defaults.watermark, ...(raw.watermark ?? {}) },
  };
}

export async function requestDocumentFullscreen(): Promise<boolean> {
  if (isFullscreenActive()) {
    setExamFullscreenClass(true);
    return true;
  }

  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };

  const options: FullscreenOptions = { navigationUI: 'hide' };

  const tryRequest = async (request: (opts?: FullscreenOptions) => Promise<void> | void, withOptions: boolean) => {
    if (withOptions) {
      await request(options);
    } else {
      await request();
    }
  };

  setExamFullscreenClass(true);

  if (el.requestFullscreen) {
    try {
      await tryRequest(el.requestFullscreen.bind(el), true);
      if (isFullscreenActive()) return true;
    } catch {
      /* fall through */
    }
    try {
      await tryRequest(el.requestFullscreen.bind(el), false);
      if (isFullscreenActive()) return true;
    } catch {
      setExamFullscreenClass(false);
      return false;
    }
  }

  if (el.webkitRequestFullscreen) {
    try {
      await el.webkitRequestFullscreen(options);
      if (isFullscreenActive()) return true;
    } catch {
      try {
        await el.webkitRequestFullscreen();
        if (isFullscreenActive()) return true;
      } catch {
        setExamFullscreenClass(false);
        return false;
      }
    }
  }

  if (el.msRequestFullscreen) {
    try {
      await el.msRequestFullscreen();
      if (isFullscreenActive()) return true;
    } catch {
      setExamFullscreenClass(false);
      return false;
    }
  }

  setExamFullscreenClass(false);
  return false;
}

export async function exitDocumentFullscreen(): Promise<void> {
  const doc = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };

  const exit = document.exitFullscreen?.bind(document)
    ?? doc.webkitExitFullscreen?.bind(document)
    ?? doc.msExitFullscreen?.bind(document);

  if (!exit || !isFullscreenActive()) {
    setExamFullscreenClass(false);
    return;
  }

  try {
    await exit();
  } catch {
    /* ignore */
  } finally {
    setExamFullscreenClass(false);
  }
}
