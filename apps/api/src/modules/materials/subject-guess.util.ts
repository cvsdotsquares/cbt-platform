import { guessSubjectId, type SubjectHint } from '@cbt/shared';

export type { SubjectHint };

export function guessSubjectIdForClass(
  fileName: string,
  title: string,
  subjects: SubjectHint[],
  fallbackSubjectId?: string | null,
): string | null {
  return guessSubjectId(fileName, title, subjects, fallbackSubjectId);
}
