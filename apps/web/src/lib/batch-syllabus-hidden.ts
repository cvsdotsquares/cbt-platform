import type { BatchSubjectBookSection } from '@/lib/batch-syllabus';

const STORAGE_KEY = 'batch-syllabus-hidden-v1';

type HiddenStore = Record<string, string[]>;

function readStore(): HiddenStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HiddenStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: HiddenStore) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Stable key for hiding a syllabus book section on one batch only. */
export function batchSectionHideKey(section: Pick<BatchSubjectBookSection, 'hideKey' | 'key'>): string {
  return section.hideKey ?? section.key;
}

export function readHiddenBatchSyllabusBooks(batchId: string): Set<string> {
  if (!batchId) return new Set();
  return new Set(readStore()[batchId] ?? []);
}

export function hideBatchSyllabusBook(batchId: string, hideKey: string): string[] {
  if (!batchId || !hideKey) return [];
  const store = readStore();
  const current = new Set(store[batchId] ?? []);
  current.add(hideKey);
  const next = [...current];
  store[batchId] = next;
  writeStore(store);
  return next;
}

export function unhideBatchSyllabusBook(batchId: string, hideKey: string): string[] {
  if (!batchId || !hideKey) return [];
  const store = readStore();
  const current = new Set(store[batchId] ?? []);
  current.delete(hideKey);
  const next = [...current];
  if (next.length) store[batchId] = next;
  else delete store[batchId];
  writeStore(store);
  return next;
}
