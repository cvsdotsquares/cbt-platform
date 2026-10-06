type ClassTestSubjectExam = {
  settings?: {
    combinedSubjects?: boolean;
    subjectId?: string;
    subjectName?: string;
    subjectScopeLabel?: string;
    [key: string]: unknown;
  } | null;
  sections?: { name?: string | null }[] | null;
  aiTestConfig?: { subjectId?: string | null } | null;
};

const GENERIC_SECTION_RE = /^section\s+[a-z0-9]+$/i;

export function isGenericExamSectionName(name: string): boolean {
  return GENERIC_SECTION_RE.test(name.trim());
}

export function buildSubjectNameLookup(
  classes: { subjects?: { id: string; name: string }[] }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cls of classes) {
    for (const subject of cls.subjects ?? []) {
      map.set(subject.id, subject.name);
    }
  }
  return map;
}

/** User-facing scope: one subject name or "All subjects" (replaces internal AI-* exam codes). */
export function classTestSubjectLabel(
  exam: ClassTestSubjectExam,
  subjectNames?: ReadonlyMap<string, string>,
): string {
  if (exam.settings?.combinedSubjects) return 'All subjects';

  const scopeLabel = exam.settings?.subjectScopeLabel?.trim();
  if (scopeLabel) return scopeLabel;

  const settingsSubjectName = exam.settings?.subjectName?.trim();
  if (settingsSubjectName) return settingsSubjectName;

  const sectionNames = (exam.sections ?? [])
    .map((s) => s.name?.trim())
    .filter((n): n is string => Boolean(n));

  const subjectSections = sectionNames.filter((n) => !isGenericExamSectionName(n));
  if (subjectSections.length > 1) return 'All subjects';
  if (subjectSections.length === 1) return subjectSections[0];

  const subjectId = exam.settings?.subjectId ?? exam.aiTestConfig?.subjectId ?? null;
  if (subjectId && subjectNames?.get(subjectId)) {
    return subjectNames.get(subjectId)!;
  }

  if (sectionNames.length > 1) return 'All subjects';
  return 'Single subject';
}
