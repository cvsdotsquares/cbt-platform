export type SubjectHint = { id: string; name: string; code: string };

const SUBJECT_PATTERNS: { pattern: RegExp; hints: string[] }[] = [
  { pattern: /\benglish\b|\beng(?:lish)?\b/i, hints: ['english', 'eng'] },
  { pattern: /\bmathematics\b|\bmaths?\b|\bmath\b/i, hints: ['mathematics', 'maths', 'math'] },
  {
    pattern: /\bsocial\s*science\b|\bsst\b|\bhistory\b|\bgeography\b|\bcivics\b|\beconomics\b/i,
    hints: ['social', 'sst', 'history', 'geography'],
  },
  { pattern: /\bphysics\b|\bphy\b/i, hints: ['physics', 'phy'] },
  { pattern: /\bchemistry\b|\bchem\b/i, hints: ['chemistry', 'chem'] },
  { pattern: /\bbiology\b|\bbio\b/i, hints: ['biology', 'bio'] },
  { pattern: /\bscience\b|\bsci\b/i, hints: ['science', 'sci'] },
  { pattern: /\bhindi\b/i, hints: ['hindi', 'hin'] },
  { pattern: /\bsanskrit\b/i, hints: ['sanskrit', 'san'] },
];

function subjectTokens(subject: SubjectHint): Set<string> {
  const tokens = new Set<string>([subject.name.toLowerCase().trim()]);
  if (subject.code) tokens.add(subject.code.toLowerCase().trim());
  return tokens;
}

function matchesHint(tokens: Set<string>, hints: string[]): boolean {
  if (hints.some((h) => tokens.has(h))) return true;
  for (const hint of hints) {
    for (const t of tokens) {
      if (hint.includes(t) || t.includes(hint)) return true;
    }
  }
  return false;
}

export function guessSubjectId(
  fileName: string,
  title: string,
  subjects: SubjectHint[],
  fallbackSubjectId?: string | null,
): string | null {
  if (!subjects.length) return fallbackSubjectId ?? null;

  const haystack = `${fileName} ${title}`.toLowerCase();
  for (const { pattern, hints } of SUBJECT_PATTERNS) {
    if (!pattern.test(haystack)) continue;
    for (const subject of subjects) {
      if (matchesHint(subjectTokens(subject), hints)) return subject.id;
    }
  }

  return fallbackSubjectId ?? null;
}
