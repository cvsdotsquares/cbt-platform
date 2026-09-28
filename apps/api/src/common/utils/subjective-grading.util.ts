const STOPWORDS = new Set([
  'about', 'after', 'also', 'among', 'and', 'are', 'because', 'been', 'being',
  'between', 'both', 'but', 'can', 'could', 'describe', 'does', 'each', 'explain',
  'for', 'from', 'have', 'help', 'here', 'how', 'into', 'its', 'like', 'more',
  'most', 'must', 'not', 'only', 'other', 'should', 'such', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'using', 'very', 'what', 'when', 'where', 'which', 'while', 'will',
  'with', 'would', 'your', 'answer', 'question', 'marks', 'award', 'relevant',
  'clear', 'clearly', 'accuracy', 'reasoning', 'concept', 'concepts',
]);

function normalizeCorrect(correct: unknown): Record<string, unknown> {
  if (!correct || typeof correct !== 'object') {
    return correct == null ? {} : { value: correct };
  }
  return correct as Record<string, unknown>;
}

export function extractSubjectiveKeywords(correct: unknown, maxTerms = 10): string[] {
  const data = normalizeCorrect(correct);
  const explicit = data.keywords ?? data.keyWords ?? data.importantKeywords;
  if (Array.isArray(explicit)) {
    const terms = explicit.map(String).map((s) => s.trim()).filter(Boolean);
    if (terms.length) return terms.slice(0, maxTerms);
  }
  if (typeof explicit === 'string' && explicit.trim()) {
    const terms = explicit.split(/[,;\n|]+/).map((s) => s.trim()).filter(Boolean);
    if (terms.length) return terms.slice(0, maxTerms);
  }

  const reference = data.value;
  const refText = reference == null ? '' : String(reference);
  const rubricText = typeof data.rubric === 'string' ? data.rubric : '';

  const keywords: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string) => {
    const cleaned = term.trim().toLowerCase();
    if (cleaned.length < 3 || STOPWORDS.has(cleaned) || seen.has(cleaned)) return;
    seen.add(cleaned);
    keywords.push(term.trim());
  };

  const tokenize = (text: string) =>
    text.toLowerCase().match(/[a-z0-9][a-z0-9\-']{2,}/g) ?? [];

  for (const source of [refText, rubricText]) {
    for (const token of tokenize(source)) {
      if (token.length < 4 || STOPWORDS.has(token)) continue;
      addTerm(token);
      if (keywords.length >= maxTerms) return keywords.slice(0, maxTerms);
    }
  }

  return keywords.slice(0, maxTerms);
}

function termPresent(haystack: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  if (haystack.includes(t)) return true;
  if (!t.includes(' ')) {
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
  }
  return haystack.includes(t);
}

export function gradeSubjectiveByKeywords(
  answerText: string,
  correct: unknown,
  maxMarks: number,
): { isCorrect: boolean | null; marksAwarded: number | null } {
  if (maxMarks <= 0) return { isCorrect: null, marksAwarded: 0 };
  const text = (answerText || '').trim();
  if (!text) return { isCorrect: null, marksAwarded: 0 };

  const keywords = extractSubjectiveKeywords(correct);
  if (!keywords.length) return { isCorrect: null, marksAwarded: null };

  const haystack = text.toLowerCase();
  const matched = keywords.filter((kw) => termPresent(haystack, kw)).length;
  const ratio = matched / keywords.length;
  const marksAwarded = Math.round(maxMarks * ratio * 100) / 100;
  return { isCorrect: matched === keywords.length, marksAwarded };
}
