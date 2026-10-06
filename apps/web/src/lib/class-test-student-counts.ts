import type { ExamListItem } from '@/lib/api';

export function classTestAssignedStudentCount(exam: Pick<ExamListItem, '_count'>): number {
  return exam._count?.registrations ?? 0;
}

export function classTestAttemptedStudentCount(exam: Pick<ExamListItem, '_count'>): number {
  const distinct = exam._count?.attemptedStudents;
  if (distinct != null) return distinct;
  const sessions = exam._count?.sessions ?? 0;
  const results = exam._count?.results ?? 0;
  return Math.max(sessions, results);
}

/** e.g. "6 assigned · 4 attempted" or "6 students · none attempted yet" */
export function formatClassTestStudentAttemptSummary(exam: Pick<ExamListItem, '_count'>): string {
  const assigned = classTestAssignedStudentCount(exam);
  const attempted = classTestAttemptedStudentCount(exam);
  if (assigned <= 0) return 'No students assigned';
  if (attempted <= 0) {
    return `${assigned} student${assigned === 1 ? '' : 's'} assigned · none attempted yet`;
  }
  return `${assigned} assigned · ${attempted} of ${assigned} attempted`;
}
