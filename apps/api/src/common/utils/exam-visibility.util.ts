import { BadRequestException } from '@nestjs/common';

/** Exam statuses visible to candidates after admin/staff publish. */
export const CANDIDATE_VISIBLE_EXAM_STATUSES = ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'] as const;

export function isExamVisibleToCandidate(status: string): boolean {
  return (CANDIDATE_VISIBLE_EXAM_STATUSES as readonly string[]).includes(status);
}

export function assertExamVisibleToCandidate(status: string): void {
  if (!isExamVisibleToCandidate(status)) {
    throw new BadRequestException('This exam has not been published yet');
  }
}
