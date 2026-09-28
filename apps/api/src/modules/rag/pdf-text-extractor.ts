import {
  collapseSpacedLetters,
  isGenericChapterLabel,
  isMathOrFormulaLine,
  isNcertPageHeaderLine,
  isSentenceFragment,
  isSubjectOnlyHeader,
  looksLikeTitleContinuation,
  looksLikeTitleStart,
  mergeTitleLines,
  parseNcertChapterOpening,
} from './ncert-text-utils';
import { sanitizeTextForDb } from './text-sanitize';

export { collapseSpacedLetters } from './ncert-text-utils';

export interface PdfExtractResult {
  /** Full text with line breaks restored from PDF layout */
  text: string;
  /** Lines that look like headings (larger font / bold / short title-like) */
  headings: string[];
  /** Likely table-of-contents block */
  tocBlock: string;
}

type TextItem = { str: string; x: number; y: number; size: number; bold: boolean };

/**
 * Extract PDF text preserving line breaks and detecting headings via font size / bold / layout.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse');

  const pageLines: string[] = [];
  const lineSizes: number[][] = [];
  const lineBold: boolean[] = [];

  const renderPage = (pageData: {
    getTextContent: () => Promise<{ items: { str: string; transform: number[]; fontName?: string }[] }>;
  }) => pageData.getTextContent().then((textContent) => {
    const items: TextItem[] = textContent.items.map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      size: Math.max(Math.abs(item.transform[0]), Math.abs(item.transform[3])) || 12,
      bold: /bold|heavy|black|demi|semibold|medium/i.test(item.fontName ?? ''),
    }));

    const lines = groupItemsIntoLines(items);
    for (const line of lines) {
      pageLines.push(line.text);
      lineSizes.push(line.sizes);
      lineBold.push(line.bold);
    }

    return `${lines.map((l) => l.text).join('\n')}\n\n`;
  });

  const parsed = await pdfParse(buffer, { pagerender: renderPage });
  const text = restructureFlowingText(parsed.text || pageLines.join('\n'));
  const lines = text.split('\n').map((l) => collapseSpacedLetters(l.trim())).filter(Boolean);

  const allSizes = lineSizes.flat();
  const medianSize = median(allSizes) || 12;
  const headingThreshold = medianSize * 1.15;

  const headings: string[] = [];
  for (let i = 0; i < pageLines.length; i++) {
    const line = collapseSpacedLetters(pageLines[i].trim());
    const sizes = lineSizes[i] ?? [];
    const avgSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : medianSize;
    const maxSize = sizes.length ? Math.max(...sizes) : avgSize;
    const bold = lineBold[i] ?? false;

    const isLarge = maxSize >= headingThreshold || avgSize >= headingThreshold;
    const isChapterPattern = /^(?:CHAPTER|Chapter)\s*\d+/i.test(line);
    const looksLikeTitle = isLikelyTitleLine(line);

    if (
      line.length >= 3
      && looksLikeTitle
      && (bold || isLarge || isChapterPattern)
    ) {
      const { merged, endIndex } = mergeHeadingBlock(pageLines, i);
      i = endIndex;
      headings.push(cleanLine(merged));
    }
  }

  const ncertTitle = parseNcertChapterOpening(text);
  if (ncertTitle && !headings.some((h) => h.toLowerCase() === ncertTitle.title.toLowerCase())) {
    headings.unshift(ncertTitle.title);
  }

  const tocBlock = extractTocBlock(lines);

  return {
    text: sanitizeTextForDb(text),
    headings: [...new Set(headings.filter(isLikelyTitleLine))],
    tocBlock: sanitizeTextForDb(tocBlock),
  };
}

function groupItemsIntoLines(items: TextItem[]): { text: string; sizes: number[]; bold: boolean }[] {
  if (!items.length) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { parts: TextItem[]; y: number }[] = [];
  const yTolerance = 3;

  for (const item of sorted) {
    const existing = lines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
    if (existing) {
      existing.parts.push(item);
    } else {
      lines.push({ parts: [item], y: item.y });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const parts = line.parts.sort((a, b) => a.x - b.x);
      return {
        text: parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim(),
        sizes: parts.map((p) => p.size),
        bold: parts.some((p) => p.bold),
      };
    })
    .filter((l) => l.text.length > 0);
}

function restructureFlowingText(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n');

  t = t.replace(/([A-Za-z])\s*:\s*\n\s*([A-Z])/g, '$1: $2');

  t = t.replace(/\s+(Chapter\s+\d+)/gi, '\n\n$1');
  t = t.replace(/\s+(CHAPTER\s+\d+)/gi, '\n\n$1');
  t = t.replace(/\s+(\d{1,2})\s*[.)]\s+(?=[A-Z])/g, '\n$1. ');
  t = t.replace(/\s+(\d+\.\d+)\s+(?=[A-Z])/g, '\n$1 ');

  return t
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isContentsHeading(line: string): boolean {
  const collapsed = line.trim().replace(/\s+/g, '').toLowerCase();
  return collapsed === 'contents' || collapsed === 'tableofcontents' || collapsed === 'index';
}

function extractTocBlock(lines: string[]): string {
  const startIdx = lines.findIndex((l) => isContentsHeading(l));
  if (startIdx < 0) {
    return lines.slice(0, Math.min(80, lines.length)).join('\n');
  }

  const tocLines: string[] = [collapseSpacedLetters(lines[startIdx])];
  for (let i = startIdx + 1; i < Math.min(startIdx + 80, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^appendix\b/i.test(line)) {
      tocLines.push(line);
      continue;
    }
    if (
      /^(constitution of india|fundamental rights|fundamental duties)\b/i.test(line)
      || /^click here to buy/i.test(line)
    ) {
      break;
    }
    if (
      /^\d{1,2}\s*[.)]/.test(line)
      || /^chapter\s+\d+/i.test(line)
      || /^[A-Za-z]/.test(line)
    ) {
      tocLines.push(line);
    }
  }
  return tocLines.join('\n');
}

function mergeHeadingBlock(
  pageLines: string[],
  startIndex: number,
): { merged: string; endIndex: number } {
  let merged = collapseSpacedLetters(pageLines[startIndex].trim());
  let i = startIndex;
  const isChapterOnly = /^(?:CHAPTER|Chapter)\s*\d{1,2}\s*$/i.test(merged);

  while (i + 1 < pageLines.length) {
    const next = collapseSpacedLetters(pageLines[i + 1].trim());
    if (!next || next.length > 100) break;
    if (/^\d{1,2}\s*[.)]/.test(next)) break;

    const titleSoFar = isChapterOnly
      ? merged.replace(/^(?:CHAPTER|Chapter)\s*\d+\s*/i, '').trim()
      : merged;

    const shouldMerge =
      /:\s*$/.test(merged)
      || (isChapterOnly && !titleSoFar && looksLikeTitleStart(next))
      || (titleSoFar && looksLikeTitleContinuation(next, titleSoFar))
      || looksLikeTitleContinuation(next, merged);

    if (!shouldMerge) break;

    i++;
    merged = `${merged} ${next}`;
  }

  return { merged, endIndex: i };
}

function isLikelyTitleLine(line: string): boolean {
  const t = collapseSpacedLetters(line.trim());
  if (t.length < 3 || t.length > 120) return false;

  const words = t.split(/\s+/);
  if (words.length > 14) return false;
  if (isGenericChapterLabel(t)) return false;
  if (isMathOrFormulaLine(t)) return false;
  if (isSubjectOnlyHeader(t)) return false;
  if (isNcertPageHeaderLine(t)) return false;
  if (isSentenceFragment(t)) return false;

  if (/^(?:CHAPTER|Chapter)\s*\d+\s*[-:.\s]+\S/i.test(t)) return true;

  const alphaWords = words.filter((w) => /[A-Za-z]{2,}/.test(w));
  if (alphaWords.length >= 1 && words.length <= 14) return true;

  return false;
}

function cleanLine(line: string): string {
  return collapseSpacedLetters(line)
    .replace(/\s+/g, ' ')
    .replace(/\s+\d{1,4}$/, '')
    .replace(/\.{2,}.*$/, '')
    .trim();
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
