/** Remove NCERT table-of-contents page numbers accidentally kept on chapter titles. */
export function displayChapterTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title
    .replace(/\s*\.{2,}\s*\d+\s*$/, '')
    .replace(/\s+\d{1,4}\s*$/, '')
    .trim();
}
