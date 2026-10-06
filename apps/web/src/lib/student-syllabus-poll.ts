import type { QueryClient } from '@tanstack/react-query';

/** How often the student Test syllabus view refetches while that tab is open. */
export const STUDENT_SYLLABUS_POLL_MS = 5_000;

/** Tab id on `/my-exams` for the live test syllabus view (label: "Test syllabus"). */
export const STUDENT_SYLLABUS_TAB = 'progress' as const;

export const STUDENT_LEARNING_QUERY_KEY = ['student-learning'] as const;

/** Call when books or batch syllabus progress change (admin/teacher actions). */
export function invalidateStudentSyllabusLive(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: STUDENT_LEARNING_QUERY_KEY });
}
