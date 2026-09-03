'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { proctoringApi } from '@/lib/api';
import type { ExamSecurityPolicy } from '@cbt/shared';
import {
  isFullscreenActive,
  normalizeSecurityPolicy,
  requestDocumentFullscreen,
  syncExamFullscreenClass,
} from '@/lib/exam-security-policy';

interface UseExamSecurityOptions {
  sessionId: string;
  accessToken: string;
  policy?: Partial<ExamSecurityPolicy> & { fullscreenRequired?: boolean };
  candidateLabel?: string;
  enabled?: boolean;
}

export function useExamSecurity({
  sessionId,
  accessToken,
  policy = {},
  candidateLabel = '',
  enabled = true,
}: UseExamSecurityOptions) {
  const normalizedPolicy = normalizeSecurityPolicy(policy);
  const fullscreenRequired = normalizedPolicy.fullscreen !== false;
  const [violations, setViolations] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(() => !fullscreenRequired);
  const reportedRef = useRef(new Set<string>());

  const report = useCallback(async (
    eventType: string,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    metadata?: Record<string, unknown>,
  ) => {
    const key = `${eventType}-${Date.now()}`;
    if (reportedRef.current.has(eventType) && severity === 'LOW') return;
    reportedRef.current.add(eventType);
    setViolations((v) => v + 1);
    try {
      await proctoringApi.recordEvent(accessToken, { sessionId, eventType, severity, metadata });
    } catch { /* silent */ }
    setTimeout(() => reportedRef.current.delete(eventType), 5000);
  }, [accessToken, sessionId]);

  const enterFullscreen = useCallback(async () => {
    if (!fullscreenRequired) {
      setIsFullscreen(true);
      return true;
    }
    if (isFullscreenActive()) {
      setIsFullscreen(true);
      return true;
    }
    const ok = await requestDocumentFullscreen();
    const active = ok || isFullscreenActive();
    setIsFullscreen(active);
    syncExamFullscreenClass();
    return active;
  }, [fullscreenRequired]);

  useEffect(() => {
    if (!enabled) return;
    if (!fullscreenRequired) {
      setIsFullscreen(true);
      return;
    }
    syncExamFullscreenClass();
    setIsFullscreen(isFullscreenActive());
  }, [enabled, fullscreenRequired]);

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.hidden) {
        report('TAB_SWITCH', 'HIGH', { action: 'tab_hidden' });
      }
    };

    const onBlur = () => report('WINDOW_BLUR', 'MEDIUM', { action: 'window_blur' });

    const onCopy = (e: ClipboardEvent) => {
      if (normalizedPolicy.blockCopyPaste) {
        e.preventDefault();
        report('COPY_ATTEMPT', 'MEDIUM');
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (normalizedPolicy.blockCopyPaste) {
        e.preventDefault();
        report('PASTE_ATTEMPT', 'MEDIUM');
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      if (normalizedPolicy.blockRightClick) {
        e.preventDefault();
        report('RIGHT_CLICK', 'LOW');
      }
    };

    const onFullscreenChange = () => {
      const fs = isFullscreenActive();
      syncExamFullscreenClass();
      setIsFullscreen(fullscreenRequired ? fs : true);
      if (!fs && fullscreenRequired) {
        report('FULLSCREEN_EXIT', 'HIGH');
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (normalizedPolicy.blockCopyPaste && (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        report('COPY_ATTEMPT', 'MEDIUM', { key: e.key });
      }
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        if (normalizedPolicy.detectDevTools) report('DEVTOOLS', 'HIGH');
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
      if (!isFullscreenActive()) {
        syncExamFullscreenClass();
      }
    };
  }, [enabled, normalizedPolicy, fullscreenRequired, report]);

  const watermarkEnabled = normalizedPolicy.watermark?.enabled ?? false;

  return { violations, isFullscreen, enterFullscreen, watermarkEnabled, candidateLabel };
}
