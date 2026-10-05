const STORAGE_KEY = 'batch-books-notes-pins-v1';

type PinStore = Record<string, string[]>;

function readStore(): PinStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PinStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: PinStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Material ids pinned to appear in Books & Notes for a batch. */
export function readBooksNotesPins(batchId: string): string[] {
  if (!batchId) return [];
  return readStore()[batchId] ?? [];
}

export function toggleBooksNotesPin(batchId: string, materialId: string, pinned: boolean): string[] {
  if (!batchId || !materialId) return [];
  const store = readStore();
  const current = new Set(store[batchId] ?? []);
  if (pinned) current.add(materialId);
  else current.delete(materialId);
  const next = [...current];
  store[batchId] = next;
  writeStore(store);
  return next;
}

export function setBooksNotesPins(batchId: string, materialIds: string[]): string[] {
  if (!batchId) return [];
  const store = readStore();
  store[batchId] = [...new Set(materialIds)];
  writeStore(store);
  return store[batchId];
}
