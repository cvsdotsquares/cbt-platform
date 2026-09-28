/** Utilities for NCERT PDF text kerning artifacts (e.g. "P OLYNOMIALS", "M ATHEMA TICS"). */

const SUBJECT_HEADERS = new Set([
  'mathematics', 'maths', 'science', 'physics', 'chemistry', 'biology',
  'english', 'hindi', 'social science', 'economics', 'geography', 'history',
  'civics', 'political science', 'accountancy', 'business studies',
  'ganita manjari', 'kaveri',
]);

const TITLE_WORDS = [
  'introduction', 'applications', 'probability', 'statistics', 'progressions',
  'arithmetic', 'quadratic', 'equations', 'polynomials', 'trigonometry',
  'coordinate', 'geometry', 'constructions', 'circles', 'triangles',
  'surface', 'areas', 'volumes', 'related', 'numbers', 'real', 'linear',
  'pair', 'variables', 'two', 'three', 'dimensional', 'limits', 'derivatives',
  'integrals', 'matrices', 'determinants', 'vectors', 'algebra', 'programming',
  'sets', 'relations', 'functions', 'complex', 'permutations', 'combinations',
  'binomial', 'theorem', 'sequences', 'series', 'lines', 'conic', 'sections',
  'inverse', 'trigonometric', 'measuring', 'space', 'perimeter', 'area',
  'exploring', 'algebraic', 'identities', 'world', 'orienting', 'yourself',
  'use', 'coordinates', 'maybe', 'predicting', 'what', 'comes', 'next',
  'up', 'down', 'round', 'and', 'of', 'in', 'to', 'the', 'for', 'on', 'with',
  'a', 'an', 'by', 'from', 'into', 'its', 'their', 'our', 'your',
].sort((a, b) => b.length - a.length);

const KNOWN_TITLES: Record<string, string> = {
  realnumbers: 'Real Numbers',
  polynomials: 'Polynomials',
  pairoflinearequationsintwovariables: 'Pair of Linear Equations in Two Variables',
  quadraticequations: 'Quadratic Equations',
  arithmeticprogressions: 'Arithmetic Progressions',
  triangles: 'Triangles',
  coordinategeometry: 'Coordinate Geometry',
  introductiontotrigonometry: 'Introduction to Trigonometry',
  applicationsoftrigonometry: 'Applications of Trigonometry',
  circles: 'Circles',
  constructions: 'Constructions',
  areasrelatedtocircles: 'Areas Related to Circles',
  surfaceareasandvolumes: 'Surface Areas and Volumes',
  statistics: 'Statistics',
  probability: 'Probability',
  mathematics: 'Mathematics',
};

/** Collapse NCERT letter-spaced kerning: "P OLYNOMIALS" → "Polynomials", "M ATHEMA TICS" → "Mathematics". */
export function collapseSpacedLetters(line: string): string {
  let trimmed = line.trim();
  if (!trimmed) return trimmed;

  // Strip page/chapter numbers at edges before kerning detection
  trimmed = trimmed.replace(/^\d+\s+/, '').replace(/\s+\d{1,2}\s*$/, '');

  const collapsed = trimmed.replace(/\s+/g, '');
  if (/^contents$/i.test(collapsed) || /^tableofcontents$/i.test(collapsed)) {
    return 'Contents';
  }

  const words = trimmed.split(/\s+/);
  const allAlpha = words.every((w) => /^[A-Za-z]+$/.test(w));
  const hasSingleLetterWord = words.some((w) => w.length === 1);
  const letterFragments = words.filter((w) => /^[A-Za-z]{1,15}$/.test(w)).length;
  const looksKerned = words.length >= 2 && allAlpha && (
    hasSingleLetterWord
    || letterFragments / words.length >= 0.75
  );

  if (looksKerned && /^[A-Za-z]{3,100}$/.test(collapsed)) {
    return formatCollapsedTitle(collapsed);
  }

  return line.trim();
}

export function formatCollapsedTitle(collapsed: string): string {
  const key = collapsed.toLowerCase().replace(/[^a-z]/g, '');
  if (KNOWN_TITLES[key]) return KNOWN_TITLES[key];

  const segmented = segmentWords(key);
  if (segmented.length) {
    return segmented
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  if (collapsed === collapsed.toUpperCase()) {
    return collapsed.charAt(0) + collapsed.slice(1).toLowerCase();
  }
  return collapsed;
}

function segmentWords(s: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const word of TITLE_WORDS) {
      if (s.startsWith(word, i)) {
        result.push(word);
        i += word.length;
        matched = true;
        break;
      }
    }
    if (!matched) return [];
  }
  return result;
}

export function isSubjectOnlyHeader(title: string): boolean {
  const key = collapseSpacedLetters(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return SUBJECT_HEADERS.has(key);
}

/** Page header like "24 M ATHEMATICS" or "26 Mathematics" — not a chapter title. */
export function isNcertPageHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;

  const withoutPage = t.replace(/^\d+\s+/, '').trim();
  const collapsed = withoutPage.replace(/\s+/g, '').toLowerCase();
  if (collapsed === 'mathematics' || collapsed === 'science' || collapsed === 'physics') {
    return true;
  }

  if (/^\d+\s+M\s*(?:A\s*)?T?\s*H?\s*E?\s*M?\s*A?\s*T?\s*I?\s*C?\s*S?\s*$/i.test(t)) {
    return true;
  }

  return isSubjectOnlyHeader(withoutPage);
}

/** Sentence fragment from body text — not a heading. */
export function isSentenceFragment(title: string): boolean {
  const t = title.trim();
  if (!t) return true;

  if (/\([^)]{8,}\)/.test(t)) return true;
  if (/\b(whose|which|where|when|while|because|although|however|therefore|coefficients|real numbers|variable|polynomial|example|expressions)\b/i.test(t) && t.split(/\s+/).length >= 4) {
    return true;
  }

  if (/[.!?]$/.test(t)) {
    if (/^(not|is|are|was|were|has|have|had|will|would|can|could|should|may|might|do|does|did|be|been|being)\b/i.test(t)) {
      return true;
    }
    if (/\b(not|is|are|was|were|has|have|had|will|would|can|could|should|the|a|an|of|in|on|at|to|for|with|by|from|that|this|these|those|it|they|we|you|he|she)\b/i.test(t)) {
      return true;
    }
  }

  if (/^(not|also|however|therefore|hence|thus|since|because|although|while|when|where|if|unless|until|before|after|during|through|between|among|into|onto|upon|toward|towards|without|within|throughout|nevertheless|moreover|furthermore|meanwhile|otherwise|instead|rather|quite|very|just|only|even|still|already|yet|again|once|twice|here|there|now|then|so|such|same|other|another|each|every|both|all|any|some|many|much|more|most|few|less|least|several|enough)\b/i.test(t)) {
    return true;
  }

  return false;
}

export function isMathOrFormulaLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;

  const tokens = t.split(/\s+/);
  if (tokens.every((w) => /^[A-Za-z]+$/.test(w))) return false;

  if (/[=≠≤≥<>]/.test(t) && /[a-zA-Z]/.test(t)) return true;
  if (tokens.length >= 2) {
    const singleChar = tokens.filter((w) => w.length === 1).length;
    if (singleChar / tokens.length > 0.35) return true;

    const numeric = tokens.filter((w) => /^[\d().,]+$/.test(w)).length;
    if (numeric / tokens.length > 0.55) return true;
  }

  if (/^[\d\s+\-−×÷*/=().,xyabn]+$/i.test(t) && /[+\-−=×÷*/]/.test(t)) return true;
  if (/^\d+\s+\d+\s+\d+$/.test(t)) return true;

  const compact = t.replace(/\s+/g, '');
  if (/^(.)\1{2,}$/i.test(compact)) return true;

  return false;
}

/** True if a line can start a chapter title (first line after CHAPTER N, etc.). */
export function looksLikeTitleStart(line: string): boolean {
  const t = collapseSpacedLetters(line.trim());
  if (!t || t.length < 2 || t.length > 100) return false;
  if (isGenericChapterLabel(t)) return false;
  if (isNcertPageHeaderLine(t)) return false;
  if (isMathOrFormulaLine(t)) return false;
  if (isSubjectOnlyHeader(t)) return false;
  if (/^(?:CHAPTER|Chapter)\s*\d/i.test(t)) return false;
  if (/^\d+\.\d+\s/.test(t)) return false;
  if (isSentenceFragment(t) && t.split(/\s+/).length > 8) return false;
  return /^[A-Za-z0-9]/.test(t) && t.split(/\s+/).length <= 10;
}

/** True if line continues a multi-line chapter title on the next row. */
export function looksLikeTitleContinuation(line: string, existingTitle: string): boolean {
  const t = collapseSpacedLetters(line.trim());
  const prior = existingTitle.trim();
  if (!t || t.length > 100 || !prior) return false;
  if (isGenericChapterLabel(t)) return false;
  if (isNcertPageHeaderLine(t)) return false;
  if (/^(?:CHAPTER|Chapter)\s*\d/i.test(t)) return false;
  if (/^\d+\.\d+\s/.test(t)) return false;
  if (/^\d{1,2}\s*[.)]\s/.test(t)) return false;

  const words = t.split(/\s+/);
  if (words.length > 10) return false;
  if (prior.split(/\s+/).length + words.length > 14) return false;

  if (/:\s*$/.test(prior)) return true;
  if (/^(in|of|and|or|to|for|the|a|an|with|from|on|at|by)\s/i.test(t) && words.length <= 8) return true;

  if (/^[A-Z][A-Za-z\s]{2,}$/.test(t) && prior.split(/\s+/).length <= 10 && !isSentenceFragment(t)) {
    return true;
  }

  if (
    prior.split(/\s+/).length <= 10
    && /^[A-Z]/.test(t)
    && words.length <= 8
    && !isSentenceFragment(t)
  ) {
    return true;
  }

  return false;
}

/** Merge consecutive lines into one chapter title starting at startIndex. */
export function mergeTitleLines(lines: string[], startIndex: number, maxLines = 6): string {
  const parts: string[] = [];

  for (let i = startIndex; i < Math.min(startIndex + maxLines, lines.length); i++) {
    const line = collapseSpacedLetters(lines[i].trim());
    if (!line) {
      if (parts.length) break;
      continue;
    }

    if (parts.length === 0) {
      if (!looksLikeTitleStart(line)) break;
      parts.push(line);
    } else if (looksLikeTitleContinuation(line, parts.join(' '))) {
      parts.push(line);
    } else {
      break;
    }
  }

  return parts.join(' ');
}

/**
 * Parse NCERT Class 10 Maths (and similar) chapter opening headers.
 * Handles kerning split across segments: "P AIR OF L INEAR E QUATIONS | IN T WO V ARIABLES 3"
 */
export function parseNcertChapterOpening(text: string): { number: number; title: string } | null {
  const sample = text.slice(0, 6000);

  const introMatch = sample.match(/^([\s\S]+?)\b(\d{1,2})\.1\s+Introduction/im);
  const headerBlock = introMatch
    ? introMatch[1]
    : sample.split('\n').slice(0, 8).join('\n');

  const parts = headerBlock.split(/\n|\|/).map((p) => p.trim()).filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (isNcertPageHeaderLine(part)) continue;

    const endNum = part.match(/^(.+?)\s+(\d{1,2})\s*$/);
    if (!endNum || /^\d+$/.test(endNum[1].trim())) continue;

    const number = parseInt(endNum[2], 10);
    if (number < 1 || number > 40) continue;

    const titleSegments = [endNum[1]];
    for (let j = i - 1; j >= 0; j--) {
      const prev = parts[j];
      if (isNcertPageHeaderLine(prev)) break;
      if (/^\d+$/.test(prev)) break;
      if (/^\d+\.\d+/.test(prev)) break;

      const candidate = `${prev} ${titleSegments.join(' ')}`;
      if (candidate.split(/\s+/).length > 14) break;
      if (isSentenceFragment(prev) && prev.split(/\s+/).length > 6) break;

      if (
        looksLikeTitleContinuation(titleSegments[0], prev)
        || looksLikeTitleStart(prev)
      ) {
        titleSegments.unshift(prev);
        if (titleSegments.length >= 6) break;
      } else {
        break;
      }
    }

    const rawTitle = titleSegments.join(' ');
    const title = collapseSpacedLetters(rawTitle);
    if (
      title.length >= 3
      && !isSubjectOnlyHeader(title)
      && !isSentenceFragment(title)
      && !isMathOrFormulaLine(title)
    ) {
      return { number, title };
    }
  }

  for (const raw of parts.slice(0, 15)) {
    const line = raw.trim();
    if (!line || isNcertPageHeaderLine(line)) continue;

    const chapterLine = line.match(/^(?:CHAPTER|Chapter)\s*[-:]?\s*(\d{1,2})\s*[-:.\s]+(.+)$/i);
    if (chapterLine) {
      const title = collapseSpacedLetters(chapterLine[2].replace(/\s+\d{1,2}\s*$/, ''));
      const number = parseInt(chapterLine[1], 10);
      if (title.length >= 3 && !isSubjectOnlyHeader(title)) {
        return { number, title };
      }
    }
  }

  return null;
}

/** Standalone "CHAPTER" labels, quote lines ending in CHAPTER, etc. — not real titles. */
export function isGenericChapterLabel(title: string): boolean {
  const t = title.trim();
  if (!t) return true;

  const key = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (key === 'chapter' || key === 'ch') return true;

  // "CHAPTER 4" with no descriptive title
  if (/^(?:chapter|ch)\s*\d{1,2}\s*$/i.test(t)) return true;

  // Quote attribution before chapter heading: "Martin H. Fischer CHAPTER"
  if (/\b(?:chapter|ch)\.?\s*$/i.test(t) && !/^(?:chapter|ch)\s*\d/i.test(t)) {
    const before = t.replace(/\s*(?:CHAPTER|Chapter|CH\.?)\s*$/i, '').trim();
    if (!before) return true;
    if (/\b[A-Z]\./.test(before) && before.split(/\s+/).length <= 5) return true;
    if (before.split(/\s+/).length < 2) return true;
  }

  return false;
}

/** Parse chapter number (and optional title hint) from upload filename. */
export function parseChapterFromFilename(fileName: string): { number: number; titleHint?: string } | null {
  const base = fileName.replace(/\.[^.]+$/, '');

  const named = base.match(/(?:chapter|ch)[-_\s]?(\d{1,2})(?:[-_\s]+(.+))?/i);
  if (named) {
    const number = parseInt(named[1], 10);
    if (number >= 1 && number <= 40) {
      const hint = named[2]?.replace(/[-_]+/g, ' ').trim();
      return { number, titleHint: hint || undefined };
    }
  }

  const trailing = base.match(/[-_\s](\d{1,2})$/);
  if (trailing) {
    const number = parseInt(trailing[1], 10);
    if (number >= 1 && number <= 40) return { number };
  }

  return null;
}

/** True when a stored chapter title is clearly a bad extraction (page header, subject name, body text). */
const SECTION_HEADINGS = new Set([
  'whatyouhavelearnt',
  'what you have learnt',
  'exercises',
  'groupactivity',
  'group activity',
  'activities',
  'summary',
  'keywords',
  'further readings',
]);

export function isInvalidChapterTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t.length < 2) return true;
  if (isGenericChapterLabel(t)) return true;
  if (isSubjectOnlyHeader(t)) return true;
  if (isNcertPageHeaderLine(t)) return true;
  if (isSentenceFragment(t)) return true;
  if (isMathOrFormulaLine(t)) return true;
  if (/^M\s+ATHEMA?\s*TICS$/i.test(t)) return true;
  if (/^M\s+ATHEMATICS$/i.test(t)) return true;

  const collapsed = collapseSpacedLetters(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (SUBJECT_HEADERS.has(collapsed)) return true;
  if (SECTION_HEADINGS.has(collapsed)) return true;

  return false;
}

/** True when PDF text extraction produced mostly symbols / unreadable content. */
export function isUnreadablePdfText(text: string): boolean {
  const sample = text.slice(0, 80000);
  if (sample.length < 1000) return true;

  const alpha = (sample.match(/[a-zA-Z]/g) ?? []).length;
  if (alpha / sample.length < 0.04) return true;

  const words = sample.match(/\b[A-Za-z]{4,}\b/g) ?? [];
  if (words.length < 30) return true;

  return false;
}

/** Detect single-chapter NCERT PDF from filename or content. */
export function looksLikeSingleChapterPdf(fileName: string, text: string): boolean {
  if (/chapter[-_\s]?\d+/i.test(fileName)) return true;

  const introCount = (text.slice(0, 12000).match(/\b\d{1,2}\.1\s+Introduction\b/gi) ?? []).length;
  if (introCount === 1) return true;

  const parsed = parseNcertChapterOpening(text);
  if (parsed && introCount <= 2) return true;

  return false;
}
