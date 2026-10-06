'use client';

import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { materialsNeedLivePoll } from '@/lib/materials-indexing-poll';
import { invalidateStudentSyllabusLive } from '@/lib/student-syllabus-poll';

/** After background indexing finishes, refresh syllabus trees and batch progress. */
export function useMaterialIndexingSync(
  queryClient: QueryClient,
  materials: { status?: string | null }[] | null | undefined,
) {
  const wasPollingRef = useRef(false);

  useEffect(() => {
    const polling = materialsNeedLivePoll(materials);
    if (wasPollingRef.current && !polling) {
      void queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      void queryClient.invalidateQueries({ queryKey: ['curriculum-all-classes'] });
      void queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['material-extracted-chapters'] });
      invalidateStudentSyllabusLive(queryClient);
    }
    wasPollingRef.current = polling;
  }, [materials, queryClient]);
}
