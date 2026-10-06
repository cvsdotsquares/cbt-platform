/** Avoid redundant labels like "Class 9 — Class 9" when the catalog name duplicates the level. */
export function formatAcademicClassLabel(level: number, name: string): string {
  const trimmed = name.trim();
  const canonical = `Class ${level}`;
  if (!trimmed) return canonical;
  const lower = trimmed.toLowerCase();
  if (lower === canonical.toLowerCase()) return canonical;
  if (/^class\s*\d+\s*[-–—·|]\s*class\s*\d+\s*$/i.test(trimmed)) return canonical;
  if (/^class\s*\d+\s*$/i.test(trimmed)) return canonical;
  return trimmed;
}

/** Sidebar/list title: "Class 10 Section A" (class + section, without repeating class on the next line). */
export function formatBatchListTitle(batch: {
  name: string;
  academicClass: { level: number; name: string };
}): string {
  const classLabel = formatAcademicClassLabel(batch.academicClass.level, batch.academicClass.name);
  let section = batch.name.trim();
  if (!section) return classLabel;

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm(section) === norm(classLabel)) return classLabel;

  const escapedClass = classLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  section = section.replace(new RegExp(`^${escapedClass}\\s*[-–—·|]?\\s*`, 'i'), '').trim();
  section = section.replace(
    new RegExp(`^class\\s*${batch.academicClass.level}\\s*[-–—·|]?\\s*`, 'i'),
    '',
  ).trim();
  section = section.replace(
    new RegExp(`\\bclass\\s*${batch.academicClass.level}\\b`, 'gi'),
    '',
  ).replace(/\s+/g, ' ').trim();

  if (!section || norm(section) === norm(classLabel)) return classLabel;
  return `${classLabel} ${section}`;
}

/** Batches may reference a different academic_class row than the curriculum dropdown (same level). */
/** Section label for batch filters (e.g. "Section A", "Test Batch"). */
function batchListSectionSortOrder(batch: {
  name: string;
  academicClass: { level: number; name: string };
}): number {
  const title = formatBatchListTitle(batch);
  const sectionMatch = title.match(/\bsection\s+([a-z0-9]+)\b/i) ?? batch.name.match(/\bsection\s+([a-z0-9]+)\b/i);
  if (sectionMatch) {
    const token = sectionMatch[1].toUpperCase();
    if (/^[A-Z]$/.test(token)) return token.charCodeAt(0) - 64;
    return 100 + token.charCodeAt(0);
  }
  if (/test\s*batch/i.test(title) || /test\s*batch/i.test(batch.name)) return 900;
  return 800;
}

/** Ascending sidebar order: class level, then section A→Z, then other batch names. */
export function compareBatchesForList(
  a: {
    name: string;
    academicYear?: string;
    academicClass: { level: number; name: string };
  },
  b: {
    name: string;
    academicYear?: string;
    academicClass: { level: number; name: string };
  },
): number {
  const levelDiff = a.academicClass.level - b.academicClass.level;
  if (levelDiff !== 0) return levelDiff;

  const sectionDiff = batchListSectionSortOrder(a) - batchListSectionSortOrder(b);
  if (sectionDiff !== 0) return sectionDiff;

  const titleDiff = formatBatchListTitle(a).localeCompare(formatBatchListTitle(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (titleDiff !== 0) return titleDiff;

  return (a.academicYear ?? '').localeCompare(b.academicYear ?? '', undefined, { numeric: true });
}

export function batchSectionKey(batch: { name: string; academicClass: { level: number; name: string } }): string {
  const title = formatBatchListTitle(batch);
  const classLabel = formatAcademicClassLabel(batch.academicClass.level, batch.academicClass.name);
  const sectionMatch = title.match(/\bsection\s+([a-z0-9]+)\b/i) ?? batch.name.match(/\bsection\s+([a-z0-9]+)\b/i);
  if (sectionMatch) return `Section ${sectionMatch[1].toUpperCase()}`;
  if (/test\s*batch/i.test(title) || /test\s*batch/i.test(batch.name)) return 'Test Batch';
  const rest = title.replace(classLabel, '').trim();
  if (rest) return rest;
  return 'General';
}

export function batchMatchesSelectedClass(
  batch: { academicClass: { id: string; level: number } },
  selectedClassId: string,
  selectedLevel: number | undefined,
): boolean {
  if (!selectedClassId) return false;
  if (batch.academicClass.id === selectedClassId) return true;
  if (selectedLevel != null && batch.academicClass.level === selectedLevel) return true;
  return false;
}
