import { examsApi, type ExamListItem } from '@/lib/api';

/** Load every exam page from the API (limit 100 per page). */
export async function fetchAllExams(token: string): Promise<ExamListItem[]> {
  const limit = 100;
  let page = 1;
  let totalPages = 1;
  const items: ExamListItem[] = [];

  while (page <= totalPages) {
    const res = await examsApi.list(token, page, '', limit);
    items.push(...(res.items ?? []));
    totalPages = Math.max(1, res.totalPages ?? 1);
    if (!(res.items?.length)) break;
    page += 1;
  }

  return items;
}
