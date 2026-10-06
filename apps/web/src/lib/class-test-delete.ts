import type { ExamListItem } from '@/lib/api';

export const CLASS_TEST_DELETE_BLOCKED_TITLE = "You can't delete this exam";

export const CLASS_TEST_DELETE_BLOCKED_MESSAGE =
  'A student has attempted or is attempting it.';

export function hasStudentAttemptedClassTest(
  exam: Pick<ExamListItem, '_count'>,
): boolean {
  const attemptedStudents = exam._count?.attemptedStudents;
  if (attemptedStudents != null) return attemptedStudents > 0;
  const sessions = exam._count?.sessions ?? 0;
  const results = exam._count?.results ?? 0;
  return sessions > 0 || results > 0;
}

export function classTestDeleteBlockedReason(exam: Pick<ExamListItem, 'status' | '_count'>): string | null {
  if (exam.status === 'COMPLETED') {
    return 'This class test is completed and cannot be deleted.';
  }
  if (hasStudentAttemptedClassTest(exam)) {
    return CLASS_TEST_DELETE_BLOCKED_MESSAGE;
  }
  return null;
}

export function canDeleteClassTest(exam: Pick<ExamListItem, 'status' | '_count'>): boolean {
  return classTestDeleteBlockedReason(exam) === null;
}
