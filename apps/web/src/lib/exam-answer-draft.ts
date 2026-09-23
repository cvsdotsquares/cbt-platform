/** Same-origin backup of in-progress exam answers. Survives a tab reload. */

export type ExamAnswerValue = string | string[];

export type ExamAnswerDraft = {
  sessionId: string;
  examId: string;
  answers: Record<string, ExamAnswerValue>;
  review: Record<string, boolean>;
  updatedAt: number;
};

const storageKey = (sessionId: string) => `cbt-exam-draft:${sessionId}`;
const examStorageKey = (examId: string) => `cbt-exam-draft:exam:${examId}`;

export function extractStoredAnswer(answer: unknown): ExamAnswerValue | undefined {
  if (answer == null || answer === '') return undefined;
  if (typeof answer === 'string') return answer;
  if (Array.isArray(answer)) {
    const values = answer.map((item) => String(item)).filter((item) => item.length > 0);
    return values.length ? values : undefined;
  }
  if (typeof answer === 'object') {
    const rec = answer as Record<string, unknown>;
    if ('value' in rec) return extractStoredAnswer(rec.value);
    if (Object.keys(rec).length === 0) return undefined;
  }
  return undefined;
}

function readByKey(storage: Storage, key: string, sessionId?: string): ExamAnswerDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExamAnswerDraft;
    if (!parsed || typeof parsed.answers !== 'object' || !parsed.sessionId) return null;
    if (sessionId && parsed.sessionId !== sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readNewest(sessionId: string, examId?: string): ExamAnswerDraft | null {
  const keys = [storageKey(sessionId)];
  if (examId) keys.push(examStorageKey(examId));
  let newest: ExamAnswerDraft | null = null;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    for (const key of keys) {
      const matchSession = key === storageKey(sessionId) ? sessionId : undefined;
      const parsed = readByKey(storage, key, matchSession);
      if (!parsed) continue;
      if (!newest || parsed.updatedAt > newest.updatedAt) newest = parsed;
    }
  }
  return newest;
}

export function readExamAnswerDraft(sessionId: string, examId?: string): ExamAnswerDraft | null {
  if (typeof window === 'undefined' || !sessionId) return null;
  return readNewest(sessionId, examId);
}

function writeKey(storage: Storage, key: string, payload: string) {
  try {
    storage.setItem(key, payload);
  } catch { /* quota / private mode */ }
}

export function writeExamAnswerDraft(draft: ExamAnswerDraft): void {
  if (typeof window === 'undefined' || !draft.sessionId) return;
  const payload = JSON.stringify({ ...draft, updatedAt: Date.now() });
  for (const storage of [window.sessionStorage, window.localStorage]) {
    writeKey(storage, storageKey(draft.sessionId), payload);
    if (draft.examId) writeKey(storage, examStorageKey(draft.examId), payload);
  }
}

export function clearExamAnswerDraft(sessionId: string, examId?: string): void {
  if (typeof window === 'undefined' || !sessionId) return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try { storage.removeItem(storageKey(sessionId)); } catch { /* ignore */ }
    if (examId) {
      try { storage.removeItem(examStorageKey(examId)); } catch { /* ignore */ }
    }
  }
}

export function mergeExamAnswers(
  server: Record<string, ExamAnswerValue>,
  draft: ExamAnswerDraft | null,
): Record<string, ExamAnswerValue> {
  const merged = { ...server };
  if (!draft) return merged;
  for (const [questionId, value] of Object.entries(draft.answers)) {
    if (extractStoredAnswer(value) != null) merged[questionId] = value;
  }
  return merged;
}
