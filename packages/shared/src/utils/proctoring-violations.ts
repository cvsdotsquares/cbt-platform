import { EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD } from '../types/exam';

const VIOLATION_LABELS: Record<string, string> = {
  NO_FACE: 'No face detected',
  MULTIPLE_FACES: 'Multiple faces detected',
  FACE_MISMATCH: 'Face mismatch',
  LOOKING_AWAY: 'Candidate looked away',
  HEAD_TURNED: 'Head turned from screen',
  PHONE_DETECTED: 'Phone detected',
  AUDIO_ANOMALY: 'Audio anomaly',
  TAB_SWITCH: 'Tab switch detected',
  WINDOW_BLUR: 'Window lost focus',
  COPY_ATTEMPT: 'Copy attempt blocked',
  PASTE_ATTEMPT: 'Paste attempt blocked',
  COPY_PASTE: 'Copy/paste attempt',
  RIGHT_CLICK: 'Right-click blocked',
  DEVTOOLS: 'Developer tools opened',
  PRINT_ATTEMPT: 'Print attempt blocked',
  SCREEN_CAPTURE: 'Screen capture detected',
  FULLSCREEN_EXIT: 'Exited fullscreen',
  VPN_DETECTED: 'VPN detected',
  VM_DETECTED: 'Virtual machine detected',
  MULTIPLE_MONITORS: 'Multiple monitors detected',
};

const VIOLATION_DESCRIPTIONS: Record<string, string> = {
  TAB_SWITCH:
    'The candidate left the exam tab or minimized the window. After repeated tab switches (part of overall security violations), the attempt may be auto-submitted per institute policy.',
  WINDOW_BLUR:
    'The exam window lost focus (another app or browser window was activated). Often logged together with tab switches.',
  FULLSCREEN_EXIT:
    'The candidate exited required fullscreen mode during the test.',
  COPY_ATTEMPT: 'A copy shortcut or copy action was blocked during the exam.',
  PASTE_ATTEMPT: 'A paste action was blocked during the exam.',
  COPY_PASTE: 'Copy or paste was attempted while copy/paste blocking is enabled.',
  RIGHT_CLICK: 'Context menu (right-click) was blocked.',
  DEVTOOLS: 'Browser developer tools may have been opened.',
  NO_FACE: 'The proctoring camera did not detect a face in frame.',
  MULTIPLE_FACES: 'More than one face was visible in the camera feed.',
  FACE_MISMATCH: 'The face did not match the reference identity check.',
  LOOKING_AWAY: 'The candidate appeared to look away from the screen for an extended period.',
  HEAD_TURNED: 'The candidate’s head turned significantly away from the camera.',
  PHONE_DETECTED: 'A phone or secondary device may have been visible.',
  AUDIO_ANOMALY: 'Unusual audio was detected during the session.',
  PRINT_ATTEMPT: 'A print action was blocked.',
  SCREEN_CAPTURE: 'Screen capture or recording may have been attempted.',
  VPN_DETECTED: 'VPN usage was detected when VPN blocking is enabled.',
  VM_DETECTED: 'A virtual machine environment was detected.',
  MULTIPLE_MONITORS: 'Multiple displays were detected.',
};

export function formatViolationLabel(eventType: string): string {
  return VIOLATION_LABELS[eventType] ?? eventType.replace(/_/g, ' ').toLowerCase();
}

export function formatViolationDescription(
  eventType: string,
  metadata?: Record<string, unknown> | null,
): string {
  const base =
    VIOLATION_DESCRIPTIONS[eventType] ??
    `Security event recorded: ${formatViolationLabel(eventType)}.`;
  const action = metadata?.action;
  if (typeof action === 'string') {
    return `${base} Detail: ${action.replace(/_/g, ' ')}.`;
  }
  return base;
}

export function autoSubmitPolicySummary(tabSwitchCount: number, totalViolations: number): string {
  const threshold = EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD;
  return (
    `This attempt allows up to ${threshold} recorded security violations before auto-submit. ` +
    `Current session: ${totalViolations} total violation(s), ${tabSwitchCount} tab switch(es). ` +
    `When violations exceed ${threshold}, the exam is submitted automatically.`
  );
}

export { EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD };
