/** Upload queue for the current browser login session (cleared on sign-out / new login). */

const STORAGE_KEY = 'cbt-materials-upload-session';

export type StoredUploadQueueItem = {
  id: string;
  title: string;
  type: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: string;
  chunkCount: number;
  academicSession: string;
  errorMessage?: string | null;
  createdAt: string;
  academicClass?: { level: number; name: string } | null;
  subject?: { name: string; code: string } | null;
  chapter?: { title: string; number: number } | null;
  topic?: { title: string } | null;
};

type MaterialsUploadSession = {
  userId: string;
  materialIds: string[];
  queue: StoredUploadQueueItem[];
};

function readRaw(): MaterialsUploadSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MaterialsUploadSession;
    if (!parsed?.userId || !Array.isArray(parsed.materialIds) || !Array.isArray(parsed.queue)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readMaterialsUploadSession(userId: string): MaterialsUploadSession | null {
  const data = readRaw();
  if (!data || data.userId !== userId) return null;
  return data;
}

export function writeMaterialsUploadSession(
  userId: string,
  materialIds: string[],
  queue: StoredUploadQueueItem[],
): void {
  if (typeof window === 'undefined') return;
  const realIds = materialIds.filter((id) => !id.startsWith('pending-upload-'));
  const snapshot = queue.filter((m) => !m.id.startsWith('pending-upload-'));
  if (!realIds.length && !snapshot.length) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ userId, materialIds: realIds, queue: snapshot } satisfies MaterialsUploadSession),
  );
}

export function clearMaterialsUploadSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}
