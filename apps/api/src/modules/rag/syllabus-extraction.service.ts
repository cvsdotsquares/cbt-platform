import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { collapseSpacedLetters, type PdfExtractResult } from './pdf-text-extractor';
import {
  isGenericChapterLabel,
  isMathOrFormulaLine,
  isNcertPageHeaderLine,
  isSentenceFragment,
  isSubjectOnlyHeader,
  looksLikeTitleContinuation,
  mergeTitleLines,
  parseNcertChapterOpening,
  parseChapterFromFilename,
} from './ncert-text-utils';
import { sanitizeTextForDb } from './text-sanitize';
import { getNcertFallbackChapters } from './ncert-syllabus-catalog';
import { isInvalidChapterTitle, isUnreadablePdfText } from './ncert-text-utils';

export interface ExtractedTopic {
  title: string;
  content: string;
  orderIndex: number;
}

export interface ExtractedChapter {
  number: number;
  title: string;
  content: string;
  topics: ExtractedTopic[];
}

interface AiSyllabusOutline {
  chapters: {
    number: number;
    title: string;
    topics?: { title: string }[];
  }[];
}

export interface ExtractOptions {
  singleChapter?: boolean;
  fallbackTitle?: string;
  fileName?: string;
  subjectName?: string;
  subjectCode?: string;
  classLevel?: number;
  pdfLayout?: PdfExtractResult;
}

@Injectable()
export class SyllabusExtractionService {
  private readonly logger = new Logger(SyllabusExtractionService.name);

  constructor(private config: ConfigService) {}

  async extractFromText(text: string, options?: ExtractOptions): Promise<ExtractedChapter[]> {
    const normalized = this.normalizeText(text);
    if (!normalized) return [];

    if (options?.singleChapter) {
      const single = await this.extractSingleChapterDocument(normalized, options);
      return single ? [single] : [];
    }

    let result: ExtractedChapter[] = [];

    const tocRegion = this.resolveTocRegion(normalized, options?.pdfLayout);
    const tocParsed = this.parseTocFromLines(tocRegion.split('\n'));
    const tocValidated = this.validateChapters(
      tocParsed.map((c) => ({ ...c, content: '' })),
      options,
    );

    const aiChapters = await this.extractWithOpenAI(normalized, options);
    const validated = this.validateChapters(aiChapters, options);
    const aiHasBookTitle = validated.some((c) => this.isLikelyBookTitle(c.title, options));

    if (
      tocValidated.length >= 2
      && (aiHasBookTitle || !validated.length || tocValidated.length > validated.length)
    ) {
      this.logger.log(`TOC extracted ${tocValidated.length} chapters`);
      result = this.attachContentFromText(normalized, tocParsed, options);
      result = this.validateChapters(result, options);
    } else if (validated.length && !this.isLowQualityExtraction(validated, options)) {
      this.logger.log(`AI extracted ${validated.length} chapters`);
      result = validated;
    } else if (validated.length) {
      this.logger.warn(`AI extraction rejected (${validated.length} chapters looked like front matter or incomplete)`);
    }

    if (!result.length) {
      const fromLayout = this.extractFromLayout(options?.pdfLayout, options);
      if (fromLayout.length) {
        this.logger.log(`Layout extracted ${fromLayout.length} chapters`);
        result = fromLayout;
      }
    }

    if (!result.length) {
      const heuristic = this.extractWithHeuristics(normalized, options);
      const validHeuristic = this.validateChapters(heuristic, options);
      if (validHeuristic.length) {
        this.logger.log(`Heuristic extracted ${validHeuristic.length} chapters`);
        result = validHeuristic;
      }
    }

    if (!result.length) {
      result = [this.buildSingleChapter(normalized, options?.fallbackTitle, options?.pdfLayout)];
    }

    result = this.enrichWithMissingTocEntries(normalized, result, options);
    return this.applyNcertFallbackIfNeeded(normalized, result, options);
  }

  private applyNcertFallbackIfNeeded(
    text: string,
    chapters: ExtractedChapter[],
    options?: ExtractOptions,
  ): ExtractedChapter[] {
    if (options?.singleChapter) return chapters;
    if (!options?.classLevel || !options?.subjectCode) return chapters;

    const validCount = chapters.filter((c) => !isInvalidChapterTitle(c.title)).length;
    const needsFallback = isUnreadablePdfText(text) || validCount < 2;

    if (!needsFallback) return chapters;

    const fallback = getNcertFallbackChapters(options.classLevel, options.subjectCode);
    if (!fallback.length) return chapters;

    this.logger.log(
      `Using NCERT catalog fallback (${fallback.length} chapters) for Class ${options.classLevel} ${options.subjectCode}`,
    );
    return fallback;
  }

  private normalizeText(text: string): string {
    return sanitizeTextForDb(text)
      .replace(/\r\n/g, '\n')
      .replace(/\f/g, '\n')
      .replace(/([A-Za-z])\s*:\s*\n\s*([A-Z])/g, '$1: $2')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private validateChapters(chapters: ExtractedChapter[], options?: ExtractOptions): ExtractedChapter[] {
    return chapters
      .map((ch) => ({
        ...ch,
        title: this.sanitizeHeading(this.fixOcrChapterTitle(ch.title), 'chapter'),
        topics: ch.topics
          .map((t) => ({ ...t, title: this.sanitizeHeading(t.title, 'topic') }))
          .filter((t) => this.isValidHeading(t.title, 'topic') && !this.isBoilerplateHeading(t.title)),
      }))
      .filter(
        (ch) => this.isValidHeading(ch.title, 'chapter')
          && !this.isBoilerplateHeading(ch.title)
          && !this.isLikelyBookTitle(ch.title, options),
      );
  }

  private isLowQualityExtraction(chapters: ExtractedChapter[], options?: ExtractOptions): boolean {
    if (!chapters.length) return true;
    if (chapters.some((c) => this.isBoilerplateHeading(c.title))) return true;
    if (chapters.some((c) => this.isLikelyBookTitle(c.title, options))) return true;
    if (chapters.some((c) => this.isMathOrFormulaLine(c.title))) return true;
    if (chapters.some((c) => this.isSubjectOnlyHeader(c.title))) return true;
    if (options?.singleChapter) {
      if (chapters.length > 1) return true;
      return !this.isValidHeading(chapters[0].title, 'chapter');
    }
    if (chapters.length < 2) return true;
    return false;
  }

  /** Reject chapter titles that match the uploaded book name (cover title ≠ chapter). */
  private isLikelyBookTitle(title: string, options?: ExtractOptions): boolean {
    if (!options?.fallbackTitle) return false;

    const titleKey = this.normalizeTitleKey(title);
    const bookKey = this.normalizeTitleKey(options.fallbackTitle);
    if (!titleKey || !bookKey) return false;
    if (titleKey === bookKey) return true;

    const bookLead = this.normalizeTitleKey(options.fallbackTitle.split(/[:–\-|]/)[0]);
    if (bookLead.length >= 10 && titleKey.startsWith(bookLead) && titleKey.includes('india')) {
      return true;
    }

    if (bookKey.includes(titleKey) && titleKey.length >= bookKey.length * 0.75) return true;
    if (titleKey.includes(bookKey) && bookKey.length >= titleKey.length * 0.75) return true;

    // NCERT 2026 SST combined book cover titles (not chapters)
    if (titleKey.includes('india and beyond')) return true;
    if (titleKey === 'understanding society') return true;

    return false;
  }

  /** Fix common NCERT PDF OCR substitutions in TOC/chapter titles. */
  private fixOcrChapterTitle(raw: string): string {
    return raw
      .replace(/^8nderstanding/i, 'Understanding')
      .replace(/6ocial/gi, 'Social')
      .replace(/6cience/gi, 'Science')
      .replace(/6haping/gi, 'Shaping')
      .replace(/6urface/gi, 'Surface')
      .replace(/6tate/gi, 'State')
      .replace(/6ociety/gi, 'Society')
      .replace(/\$tmosphere/gi, 'Atmosphere')
      .replace(/\+umans/gi, 'Humans')
      .replace(/%eginning/gi, 'Beginning')
      .replace(/%ivilisation/gi, 'Civilisation')
      .replace(/%uilding/gi, 'Building')
      .replace(/%locks/gi, 'Blocks')
      .replace(/Pu\]\]le/gi, 'Puzzle')
      .replace(/:hat/gi, 'What')
      .replace(/0arket/gi, 'Market')
      .replace(/up to\s+300\s*CE/gi, 'up to 2000 CE')
      .replace(/up to\s+0+\s*CE/gi, 'up to 2000 CE')
      .replace(/Democr\s*acy/gi, 'Democracy')
      .replace(/Earthޝs/gi, "Earth's")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isBoilerplateHeading(title: string): boolean {
    if (isGenericChapterLabel(title)) return true;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const boilerplate = [
      'constitution of india',
      'fundamental rights',
      'fundamental duties',
      'foreword',
      'about the book',
      'acknowledgement',
      'acknowledgments',
      'preface',
      'click here to buy',
      'national syllabus',
      'textbook development',
    ];
    return boilerplate.some((b) => key === b || key.startsWith(`${b} `) || key.includes(` ${b}`));
  }

  private isTocSkipLine(line: string): boolean {
    const t = line.trim();
    if (!t) return true;
    if (this.isBoilerplateHeading(t)) return true;
    if (isNcertPageHeaderLine(t)) return true;
    if (this.isSentenceFragment(t)) return true;
    if (this.isMathOrFormulaLine(t)) return true;
    if (/^(foreword|about the book|preface|acknowledgement?s?)\b/i.test(t)) return true;
    if (/^(graph\s+paper|appendix)\b/i.test(t)) return true;
    if (/^(iii|iv|v|vi|vii|viii|ix|x|xi|xii)\s*$/i.test(t)) return true;
    if (/^(foreword|about the book|preface)\s+[ivxlc]+$/i.test(t)) return true;
    if (/^(?:G+\s*)?(?:GEOGRAPHY|HISTORY|POLITICAL\s*SCIENCE|ECONOMICS)$/i.test(t.replace(/\s+/g, ' '))) return true;
    if (/^image credits$/i.test(t)) return true;
    return false;
  }

  private stripTocPageNumber(raw: string): string {
    return raw
      .replace(/\s*\.{2,}\s*\d+\s*$/, '')
      .replace(/\s+\d{1,3}\s+(?=and\b|or\b)/i, ' ')
      .replace(/\s+\d{1,3}\s*$/, '')
      .trim();
  }

  private collapseSpacedLetters(line: string): string {
    return collapseSpacedLetters(line);
  }

  private isMathOrFormulaLine(text: string): boolean {
    return isMathOrFormulaLine(text);
  }

  private isSubjectOnlyHeader(title: string): boolean {
    return isSubjectOnlyHeader(title);
  }

  private isSentenceFragment(title: string): boolean {
    return isSentenceFragment(title);
  }

  private sanitizeHeading(raw: string, kind: 'chapter' | 'topic'): string {
    let t = raw
      .replace(/\s+/g, ' ')
      .replace(/\.{2,}.*$/, '')
      .replace(/\s+\d{1,4}$/, '')
      .replace(/\s+chapter\s+.*$/i, '')
      .trim();

    if (!this.isValidHeading(t, kind)) {
      const chapterMatch = t.match(/^(?:CHAPTER|Chapter)\s*\d+\s*[-:.\s]+(.+?)(?:\s{2,}|$)/i);
      if (chapterMatch?.[1]) t = chapterMatch[1].trim();

      const sectionMatch = t.match(/^(\d+(?:\.\d+)?)\s+(.+?)(?:\s{2,}|$)/);
      if (sectionMatch?.[2] && sectionMatch[2].split(/\s+/).length <= 8) {
        t = `${sectionMatch[1]} ${sectionMatch[2]}`.trim();
      }

      const firstPhrase = t.match(/^(.{3,70}?)(?:\s{2,}|[.!?]\s|$)/);
      if (
        firstPhrase?.[1]
        && firstPhrase[1].split(/\s+/).length <= 8
        && t.split(/\s+/).length > 10
        && !/:\s*\S/.test(t)
      ) {
        t = firstPhrase[1].trim();
      }
    }

    return t.slice(0, kind === 'chapter' ? 120 : 80);
  }

  private isValidHeading(title: string, kind: 'chapter' | 'topic'): boolean {
    const t = this.collapseSpacedLetters(title.trim());
    if (t.length < 3) return false;
    if (kind === 'chapter' && isGenericChapterLabel(t)) return false;
    if (t.length > (kind === 'chapter' ? 120 : 80)) return false;

    const words = t.split(/\s+/);
    if (words.length > (kind === 'chapter' ? 14 : 10)) return false;
    if (words.length < 1) return false;

    if (/[.!?]$/.test(t) && words.length > 6 && !/:\s*[^:]/.test(t)) return false;
    if (this.isMathOrFormulaLine(t)) return false;
    if (kind === 'chapter' && this.isSubjectOnlyHeader(t)) return false;
    if (this.isSentenceFragment(t)) return false;
    if (isNcertPageHeaderLine(t)) return false;
    if (this.isNoiseHeading(t)) return false;

    const alphaWords = words.filter((w) => /[A-Za-z]{2,}/.test(w));
    if (kind === 'chapter' && alphaWords.length === 0) return false;

    // Title-style "The X: Y" headings (e.g. "The Mathematics of Maybe: Introduction to Probability")
    if (/^the\s/i.test(t) && /:\s*\S/.test(t) && words.length <= (kind === 'chapter' ? 14 : 10)) return true;

    const sentenceStarters = /^(the|in|on|at|when|this|that|these|those|it|there|as|if|because|although|while|after|before|during|from|with|which|who|what|why|a|an|our|you|we|they|he|she|for|to|of|but|or|not|is|are|was|were|has|have|had|will|would|can|could|should|may|might)\b/i;
    if (sentenceStarters.test(t) && words.length >= 6) return false;

    // Title-style headings like "How I Taught My Grandmother to Read" (common in English textbooks)
    if (/^how\s/i.test(t) && words.length <= 10 && !/[.!?]$/.test(t)) return true;

    const commonVerbs = /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|shall|should|can|could|may|might)\b/i;
    if (commonVerbs.test(t) && words.length >= 8) return false;

    return true;
  }

  /** Add chapters present in TOC but missing from AI/heuristic extraction (e.g. colon-split titles). */
  private enrichWithMissingTocEntries(
    text: string,
    chapters: ExtractedChapter[],
    options?: ExtractOptions,
  ): ExtractedChapter[] {
    if (options?.singleChapter) return chapters;

    const tocLines = this.resolveTocRegion(text, options?.pdfLayout).split('\n');
    const merged = this.mergeTocContinuationLines(tocLines);
    const tocParsed = this.parseTocFromLines(merged);
    if (!tocParsed.length) return chapters;

    const updated = [...chapters];
    const missing: { number: number; title: string; topics: ExtractedTopic[] }[] = [];

    for (const toc of tocParsed) {
      if (this.chapterTitleExists(updated, toc.title)) continue;

      const atNumber = updated.findIndex((c) => c.number === toc.number);
      if (atNumber >= 0) {
        updated[atNumber] = { ...updated[atNumber], title: toc.title };
        this.logger.log(`Corrected chapter ${toc.number} title to "${toc.title}"`);
        continue;
      }

      missing.push(toc);
      this.logger.log(`Recovered missing TOC chapter ${toc.number}: "${toc.title}"`);
    }

    if (!missing.length && updated.length === chapters.length) return chapters;

    const combined = [...updated, ...missing].sort((a, b) => a.number - b.number);
    return this.attachContentFromText(text, combined, options);
  }

  private chapterTitleExists(chapters: ExtractedChapter[], title: string): boolean {
    const key = this.normalizeTitleKey(title);
    return chapters.some((c) => {
      const ck = this.normalizeTitleKey(c.title);
      return ck === key || ck.includes(key) || key.includes(ck);
    });
  }

  private normalizeTitleKey(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private mergeTocContinuationLines(lines: string[]): string[] {
    const merged: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;

      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (!next) break;

        const numberedEntry = /^\d{1,2}\s*[.)]\s+/.test(line);
        const nextIsNewEntry = /^\d{1,2}\s*[.)]\s+/.test(next) || /^chapter\s+\d+/i.test(next);
        const titlePart = line.replace(/^\d{1,2}\s*[.)]\s+/, '');
        const lineEndsIncomplete = /[:,-]\s*$/.test(line)
          || (numberedEntry && !/\d{1,4}\s*$/.test(line) && next.length < 90 && !nextIsNewEntry)
          || (numberedEntry && looksLikeTitleContinuation(next, titlePart));

        if (lineEndsIncomplete) {
          line = `${line} ${next}`;
          i++;
        } else {
          break;
        }
      }

      merged.push(line);
    }

    return merged;
  }

  private extractFromLayout(
    layout: PdfExtractResult | undefined,
    options?: ExtractOptions,
  ): ExtractedChapter[] {
    if (!layout) return [];

    const tocChapters = this.parseTocFromLines(this.resolveTocRegion(layout.text, layout).split('\n'));
    if (tocChapters.length >= 2 && !options?.singleChapter) {
      return this.attachContentFromText(layout.text, tocChapters, options);
    }

    const fromHeadings = this.chaptersFromHeadingLines(layout.headings, layout.text);
    if (fromHeadings.length >= (options?.singleChapter ? 1 : 2)) {
      return options?.singleChapter ? [fromHeadings[0]] : fromHeadings;
    }

    return [];
  }

  private chaptersFromHeadingLines(headings: string[], fullText: string): ExtractedChapter[] {
    const chapterHeadings = headings
      .map((h) => {
        const m = h.match(/^(?:CHAPTER|Chapter)\s*[-:]?\s*(\d{1,2})\s*[-:.\s]+(.+)$/i)
          || h.match(/^(\d{1,2})\s*[.)]\s+(.+)$/);
        if (!m) return null;
        const number = parseInt(m[1], 10);
        const title = this.sanitizeHeading(m[2], 'chapter');
        if (!this.isValidHeading(title, 'chapter') || this.isMathOrFormulaLine(title)) return null;
        return { number, title, raw: h };
      })
      .filter(Boolean) as { number: number; title: string; raw: string }[];

    const unique = new Map<number, { number: number; title: string; raw: string }>();
    for (const ch of chapterHeadings) {
      if (!unique.has(ch.number)) unique.set(ch.number, ch);
    }

    const list = [...unique.values()].sort((a, b) => a.number - b.number);
    if (!list.length) return [];

    return list.map((ch, i) => {
      const next = list[i + 1];
      const start = fullText.indexOf(ch.raw);
      const end = next ? fullText.indexOf(next.raw, start + 1) : fullText.length;
      const content = start >= 0 ? fullText.slice(start, end).trim() : '';
      return {
        number: ch.number,
        title: ch.title,
        content,
        topics: [],
      };
    });
  }

  private topicsFromHeadings(headings: string[], chapterNumber: number): ExtractedTopic[] {
    const prefix = `${chapterNumber}.`;
    const topics = headings
      .map((h) => {
        const m = h.match(new RegExp(`^(${chapterNumber}\\.\\d+)\\s+(.+)$`));
        if (!m) return null;
        const title = this.sanitizeHeading(`${m[1]} ${m[2]}`, 'topic');
        if (!this.isValidHeading(title, 'topic')) return null;
        return title;
      })
      .filter(Boolean) as string[];

    return [...new Set(topics)].map((title, i) => ({
      title,
      content: '',
      orderIndex: i,
    })).filter((t) => t.title.startsWith(prefix) || t.title.includes('.'));
  }

  /** NCERT PDFs often duplicate the same TOC line back-to-back in extracted text. */
  private dedupeRepeatedTocLine(line: string): string {
    let trimmed = line.trim();

    const dupChapter = trimmed.match(/^(chapter\s+.+?)\s+\1$/i);
    if (dupChapter) trimmed = dupChapter[1];

    const half = Math.floor(trimmed.length / 2);
    if (half > 12) {
      const first = trimmed.slice(0, half).trim();
      const second = trimmed.slice(half).trim();
      if (first === second) return first;
    }
    return trimmed;
  }

  private parseTocFromLines(lines: string[]): { number: number; title: string; topics: ExtractedTopic[] }[] {
    const chapters: { number: number; title: string; topics: ExtractedTopic[] }[] = [];
    const merged = this.mergeTocContinuationLines(
      lines.map((l) => this.collapseSpacedLetters(l)),
    );

    for (let i = 0; i < merged.length; i++) {
      let normalized = this.fixOcrChapterTitle(this.dedupeRepeatedTocLine(merged[i].trim()));
      if (!normalized || this.isTocSkipLine(normalized)) continue;
      if (isNcertPageHeaderLine(normalized)) continue;
      if (/^click here to buy/i.test(normalized)) break;

      const chapterWithTitle = normalized.match(/^chapter\s+(\d{1,2})\s+(.+)$/i);
      if (chapterWithTitle) {
        const number = parseInt(chapterWithTitle[1], 10);
        const title = this.sanitizeHeading(this.stripTocPageNumber(chapterWithTitle[2]), 'chapter');
        if (
          number > 0
          && number <= 40
          && title
          && this.isValidHeading(title, 'chapter')
          && !this.isBoilerplateHeading(title)
          && !chapters.some((c) => c.number === number)
        ) {
          chapters.push({ number, title, topics: [] });
        }
        continue;
      }

      const chapterBareTitle = normalized.match(/^chapter\s+(.{5,120})$/i);
      if (chapterBareTitle && !/^\d/.test(chapterBareTitle[1].trim())) {
        const title = this.sanitizeHeading(this.stripTocPageNumber(chapterBareTitle[1]), 'chapter');
        if (
          title
          && this.isValidHeading(title, 'chapter')
          && !this.isBoilerplateHeading(title)
          && !this.chapterTitleExistsInList(chapters, title)
        ) {
          const number = (chapters.reduce((max, c) => Math.max(max, c.number), 0) || 0) + 1;
          chapters.push({ number, title, topics: [] });
        }
        continue;
      }

      const chapterHeader = normalized.match(/^chapter\s+(\d{1,2})\s*$/i);
      if (chapterHeader) {
        const number = parseInt(chapterHeader[1], 10);
        const titleParts: string[] = [];
        i++;
        while (i < merged.length) {
          const next = merged[i].trim();
          if (!next || /^chapter\s+\d+/i.test(next) || /^\d{1,2}\s*[.)]/.test(next)) {
            i--;
            break;
          }
          if (this.isTocSkipLine(next)) break;
          titleParts.push(next);
          i++;
        }
        const title = this.sanitizeHeading(
          this.stripTocPageNumber(titleParts.join(' ')),
          'chapter',
        );
        if (
          number > 0
          && number <= 40
          && title
          && this.isValidHeading(title, 'chapter')
          && !this.isBoilerplateHeading(title)
          && !chapters.some((c) => c.number === number)
        ) {
          chapters.push({ number, title, topics: [] });
        }
        continue;
      }

      const chapterPatterns = [
        /^\s*(\d{1,2})\s*[.)]\s+(.+?)(?:\s*\.{2,}\s*\d+|\s+\d{1,3})?\s*$/,
        /^\s*(\d{1,2})\s+(.{3,120})$/,
        /^\s*(\d{1,2})\s*[.)]\s+(.{3,120})$/,
      ];

      let matchedChapter = false;
      for (const pattern of chapterPatterns) {
        const m = normalized.match(pattern);
        if (!m) continue;
        const number = parseInt(m[1], 10);
        const title = this.sanitizeHeading(this.stripTocPageNumber(m[2]), 'chapter');
        if (
          number > 0
          && number <= 40
          && this.isValidHeading(title, 'chapter')
          && !this.isBoilerplateHeading(title)
          && !isNcertPageHeaderLine(normalized)
          && !this.isSentenceFragment(title)
        ) {
          const existing = chapters.find((c) => c.number === number);
          if (!existing) {
            chapters.push({ number, title, topics: [] });
          }
          matchedChapter = true;
        }
        break;
      }

      if (matchedChapter) continue;
    }

    return chapters;
  }

  private async extractWithOpenAI(text: string, options?: ExtractOptions): Promise<ExtractedChapter[]> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) return [];

    const baseUrl = this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const model = this.config.get('OPENAI_MODEL') || 'gpt-4o-mini';

    const tocRegion = this.resolveTocRegion(text, options?.pdfLayout);
    const headingHints = (options?.pdfLayout?.headings ?? []).slice(0, 40).join('\n');
    const bodySample = text.slice(0, 6000);

    const scope = options?.singleChapter
      ? 'This PDF is a SINGLE chapter document.'
      : 'This PDF is a FULL textbook.';

    const isEnglishSubject = /english|hindi|language/i.test(options?.subjectName ?? '');
    const isMathOrScience = /math|science|physics|chemistry|biology/i.test(options?.subjectName ?? '');

    const englishRules = isEnglishSubject
      ? `
- ENGLISH/LANGUAGE TEXTBOOK: Numbered units in Contents are chapters (e.g. "1. How I Taught My Grandmother to Read").
- Topics are paired poems or supplementary texts listed directly below each chapter in Contents (e.g. "Bharat Our Land", "Words").
- Do NOT treat Constitution of India, Fundamental Rights, Fundamental Duties, Foreword, or About the Book as chapters.`
      : `
- Topics are numbered sections (e.g. "1.1 Introduction", "2.3 Motion") or bold section headings within each chapter.
- For Social Science combined books, list section headings under each chapter as topics.`;

    const mathScienceRules = isMathOrScience
      ? `
- MATH/SCIENCE TEXTBOOK: Chapter titles are descriptive names like "Real Numbers", "Polynomials", "Chemical Reactions and Equations".
- NEVER use math equations, formulas, or expressions as titles (e.g. "x + 4y = 20", "3 - 9 a 1 b", "1 1 2").
- NEVER use the subject name alone (e.g. "Mathematics", "Science") as a chapter title.
- Look for the bold/large heading on the chapter opening page — usually 2-6 words of plain English.
- Page headers repeating "MATHEMATICS" or "SCIENCE" are NOT chapter titles — skip them.`
      : '';

    const systemPrompt = `You extract syllabus structure from Indian NCERT/school textbook PDFs.
${scope}

CRITICAL RULES:
- Return ONLY short HEADINGS (2-8 words), never sentences or paragraph text.
- Chapter title max 10 words. Topic title max 8 words.
- Reject paragraph text that reads like a sentence (long clauses with verbs like is/was/are/were).
- Good chapter: "The French Revolution", "The Mathematics of Maybe: Introduction to Probability", "How I Taught My Grandmother to Read"
- Titles with a colon (subtitle after colon) are valid — keep the FULL title including both parts.
- BAD (reject): "The French Revolution was a period of radical political change in France"
- NEVER use the book cover title or series name as a chapter (e.g. "Understanding Society: India and Beyond" is a BOOK title, not Chapter 1).
- Chapter 1 comes from the Contents page (e.g. "Understanding Social Science", "The French Revolution").
- SKIP front matter: Constitution of India, Fundamental Rights, Fundamental Duties, Foreword, About the Book, Acknowledgements.
${englishRules}
${mathScienceRules}
- Use ONLY text from the document. No outside knowledge.`;

    const userPrompt = `Subject: ${options?.subjectName ?? 'Unknown'}
Class: ${options?.classLevel ?? 'Unknown'}

DETECTED HEADING LINES (larger font / layout — prefer these):
${headingHints || '(none)'}

TABLE OF CONTENTS:
${tocRegion.slice(0, 8000)}

DOCUMENT TEXT SAMPLE:
${bodySample}

Return JSON: { "chapters": [{ "number": 1, "title": "short heading only", "topics": [{ "title": "section heading" }] }] }
Include all chapters from Contents. Each chapter should have 1-8 topics when section headings exist in the document.`;

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        this.logger.warn(`OpenAI syllabus extraction failed: ${res.status}`);
        return [];
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const parsed = JSON.parse(data.choices[0].message.content) as AiSyllabusOutline;
      if (!parsed.chapters?.length) return [];

      const outline = parsed.chapters
        .filter((ch) => ch.number > 0 && ch.title?.trim())
        .map((ch) => ({
          number: ch.number,
          title: this.sanitizeHeading(ch.title, 'chapter'),
          topics: (ch.topics ?? [])
            .map((t, i) => ({
              title: this.sanitizeHeading(t.title, 'topic'),
              content: '',
              orderIndex: i,
            }))
            .filter((t) => this.isValidHeading(t.title, 'topic')),
        }))
        .filter((ch) => this.isValidHeading(ch.title, 'chapter'));

      return this.attachContentFromText(text, outline, options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`OpenAI syllabus extraction error: ${msg}`);
      return [];
    }
  }

  private extractWithHeuristics(text: string, options?: ExtractOptions): ExtractedChapter[] {
    if (options?.singleChapter) {
      return [this.buildSingleChapter(text, options.fallbackTitle, options?.pdfLayout)];
    }

    const tocChapters = this.parseTocFromLines(this.resolveTocRegion(text, options?.pdfLayout).split('\n'));
    if (tocChapters.length >= 2) {
      return this.attachContentFromText(text, tocChapters, options);
    }

    const bodyChapters = this.detectChapterHeadersInBody(text);
    if (bodyChapters.length >= 2) return bodyChapters;

    return [];
  }

  private resolveTocRegion(text: string, layout?: PdfExtractResult): string {
    const fromText = this.extractTocRegion(text);
    const fromLayout = layout?.tocBlock?.trim() ?? '';

    const countChapters = (block: string) => (
      block.match(/(?:^|\n)\s*chapter\s+\S/gi) ?? []
    ).length;

    const textCount = countChapters(fromText);
    const layoutCount = countChapters(fromLayout);

    if (textCount >= 2 && textCount >= layoutCount) return fromText;
    if (layoutCount >= 2) return fromLayout;
    return fromText.length >= fromLayout.length ? fromText : fromLayout;
  }

  private extractTocRegion(text: string): string {
    const candidates: { index: number; score: number }[] = [];
    const patterns = [
      /\bTABLE OF CONTENTS\b/gi,
      /\bCONTENTS\b/gi,
      /\bc\s*o\s*n\s*t\s*e\s*n\s*t\s*s\b/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((match = re.exec(text)) !== null) {
        const sample = text.slice(match.index, match.index + 4000);
        const chapterCount = (sample.match(/(?:^|\n)\s*chapter\s+\S/gi) ?? []).length;
        const hasForeword = /\bforeword\b/i.test(sample);
        const hasAboutBook = /\babout the book\b/i.test(sample);
        const score = chapterCount * 10 + (hasForeword ? 5 : 0) + (hasAboutBook ? 3 : 0);
        candidates.push({ index: match.index, score });
      }
    }

    if (!candidates.length) return text.slice(0, 8000);

    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const start = candidates[0].index;
    return text.slice(start, start + 12000);
  }

  private detectChapterHeadersInBody(text: string): ExtractedChapter[] {
    const pattern = /(?:^|\n)\s*(?:CHAPTER|Chapter)\s*[-:]?\s*(\d{1,2})\s*[-:.\s]+([^\n]{3,120})/gi;
    const matches: { index: number; number: number; title: string }[] = [];
    let m: RegExpExecArray | null;

    while ((m = pattern.exec(text)) !== null) {
      const number = parseInt(m[1], 10);
      const title = this.sanitizeHeading(m[2], 'chapter');
      if (number > 0 && this.isValidHeading(title, 'chapter')) {
        matches.push({ index: m.index, number, title });
      }
    }

    const unique = this.dedupeByNumber(matches);
    if (unique.length < 2) return [];

    return unique.map((item, i) => {
      const start = item.index;
      const end = i + 1 < unique.length ? unique[i + 1].index : text.length;
      const content = text.slice(start, end).trim();
      return {
        number: item.number,
        title: item.title,
        content,
        topics: [],
      };
    });
  }

  private chapterTitleExistsInList(
    chapters: { number: number; title: string }[],
    title: string,
  ): boolean {
    const key = this.normalizeTitleKey(title);
    return chapters.some((c) => {
      const ck = this.normalizeTitleKey(c.title);
      return ck === key || ck.includes(key) || key.includes(ck);
    });
  }

  private attachContentFromText(
    text: string,
    outline: { number: number; title: string; topics: ExtractedTopic[] }[],
    options?: ExtractOptions,
  ): ExtractedChapter[] {
    const headerMatches = this.findChapterPositions(text, outline);

    return outline.map((ch, i) => {
      const start = headerMatches.get(ch.number) ?? -1;
      const nextChapter = outline[i + 1];
      const end = nextChapter
        ? (headerMatches.get(nextChapter.number) ?? text.length)
        : text.length;

      const content = start >= 0 ? text.slice(start, end > start ? end : text.length).trim() : '';
      const topics = this.resolveTopicsForChapter(ch, content, options);

      return {
        number: ch.number,
        title: ch.title,
        content,
        topics,
      };
    });
  }

  private resolveTopicsForChapter(
    chapter: { number: number; title: string; topics: ExtractedTopic[] },
    content: string,
    options?: ExtractOptions,
  ): ExtractedTopic[] {
    let topics = chapter.topics.length
      ? chapter.topics
      : this.detectSectionTopics(content);

    if (!topics.length && options?.pdfLayout?.headings?.length) {
      topics = this.topicsFromHeadings(options.pdfLayout.headings, chapter.number);
    }

    if (!topics.length && content) {
      topics = this.detectThematicSectionHeadings(content);
    }

    if (topics.length && content) {
      topics = this.attachTopicContent(content, topics);
    }

    return topics.slice(0, 15);
  }

  /** Detect bold-style section headings common in Social Science / Humanities chapters. */
  private detectThematicSectionHeadings(chapterContent: string): ExtractedTopic[] {
    const lines = chapterContent.split('\n').map((l) => this.collapseSpacedLetters(l.trim())).filter(Boolean);
    const candidates: { index: number; title: string }[] = [];

    for (const line of lines) {
      if (line.length < 4 || line.length > 70) continue;
      if (/^(chapter|fig|figure|table|click here|don'?t miss|let'?s explore|think about|questions and activities)/i.test(line)) {
        continue;
      }
      if (this.isMathOrFormulaLine(line)) continue;
      if (this.isBoilerplateHeading(line)) continue;
      if (isNcertPageHeaderLine(line)) continue;

      const title = this.sanitizeHeading(line, 'topic');
      if (!this.isValidHeading(title, 'topic')) continue;

      const words = title.split(/\s+/);
      if (words.length < 2 || words.length > 8) continue;

      const idx = chapterContent.indexOf(line);
      if (idx < 0) continue;

      if (candidates.some((c) => this.normalizeTitleKey(c.title) === this.normalizeTitleKey(title))) continue;
      candidates.push({ index: idx, title });
    }

    return candidates
      .sort((a, b) => a.index - b.index)
      .slice(0, 12)
      .map((item, orderIndex) => ({
        title: item.title,
        content: '',
        orderIndex,
      }));
  }

  private findChapterPositions(
    text: string,
    outline: { number: number; title: string }[],
  ): Map<number, number> {
    const positions = new Map<number, number>();
    let searchFrom = 0;

    for (const ch of outline) {
      const slice = text.slice(searchFrom);
      const titleEscaped = ch.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const colonParts = ch.title.split(/\s*:\s*/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const flexibleTitle = colonParts.length > 1
        ? colonParts.join('\\s*:\\s*')
        : titleEscaped;

      const patterns = [
        new RegExp(`(?:CHAPTER|Chapter)\\s*[-:]?\\s*${ch.number}\\s*[-:.\\s]+${flexibleTitle}`, 'i'),
        new RegExp(`(?:^|\\n)\\s*${ch.number}\\s*[.)]\\s+${flexibleTitle}`, 'i'),
        new RegExp(`(?:CHAPTER|Chapter)\\s*[-:]?\\s*${ch.number}\\b`, 'i'),
        new RegExp(flexibleTitle, 'i'),
      ];

      let found = -1;
      for (const pattern of patterns) {
        const match = pattern.exec(slice);
        if (match) {
          found = searchFrom + match.index;
          break;
        }
      }

      if (found < 0) {
        const fuzzy = this.fuzzyTitleIndex(slice, ch.title);
        if (fuzzy >= 0) found = searchFrom + fuzzy;
      }

      if (found >= 0) {
        positions.set(ch.number, found);
        searchFrom = found + Math.min(200, ch.title.length);
      }
    }

    return positions;
  }

  /** Find chapter title in OCR-corrupted PDF text using significant word matching. */
  private fuzzyTitleIndex(text: string, title: string): number {
    const sigWords = title
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length > 3);

    if (sigWords.length < 2) return -1;

    const attempts = [
      sigWords,
      sigWords.slice(1),
      sigWords.slice(-3),
      sigWords.filter((w) => !['understanding', 'introduction', 'society', 'india', 'beyond'].includes(w)),
    ];

    for (const words of attempts) {
      if (words.length < 2) continue;
      const idx = this.fuzzyWordsIndex(text, words);
      if (idx >= 0) return idx;
    }

    return -1;
  }

  private fuzzyWordsIndex(text: string, words: string[]): number {
    const gap = '[^\\w]{0,15}';
    const pattern = words
      .slice(0, 6)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join(gap);

    try {
      const regex = new RegExp(pattern, 'i');
      const match = regex.exec(text);
      return match?.index ?? -1;
    } catch {
      return -1;
    }
  }

  private attachTopicContent(chapterText: string, topics: ExtractedTopic[]): ExtractedTopic[] {
    const positioned: { index: number; topic: ExtractedTopic }[] = [];

    for (const topic of topics) {
      const escaped = topic.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}`, 'i');
      const match = pattern.exec(chapterText);
      if (match) positioned.push({ index: match.index, topic });
    }

    positioned.sort((a, b) => a.index - b.index);

    return positioned.map((entry, i) => {
      const start = entry.index;
      const end = i + 1 < positioned.length ? positioned[i + 1].index : chapterText.length;
      return {
        ...entry.topic,
        content: chapterText.slice(start, end).trim(),
        orderIndex: i,
      };
    });
  }

  private detectSectionTopics(chapterContent: string): ExtractedTopic[] {
    const pattern = /(?:^|\n)\s*(\d+\.\d+)\s+([A-Za-z][^\n]{2,60})/g;
    const matches: { index: number; title: string }[] = [];
    let m: RegExpExecArray | null;

    while ((m = pattern.exec(chapterContent)) !== null) {
      const sectionNum = m[1];
      // Skip time-like patterns (e.g. "5.00 p.m.") mistaken as section numbers
      if (/^\d{1,2}\.00$/.test(sectionNum)) continue;

      const title = this.sanitizeHeading(`${m[1]} ${m[2]}`, 'topic');
      if (this.isValidHeading(title, 'topic')) {
        matches.push({ index: m.index, title });
      }
    }

    const unique = matches
      .filter((item, i, arr) => arr.findIndex((x) => x.title === item.title) === i)
      .slice(0, 25);

    return unique.map((item, i) => {
      const start = item.index;
      const end = i + 1 < unique.length ? unique[i + 1].index : chapterContent.length;
      return {
        title: item.title,
        content: chapterContent.slice(start, end).trim(),
        orderIndex: i,
      };
    });
  }

  private buildSingleChapter(
    text: string,
    fallbackTitle?: string,
    layout?: PdfExtractResult,
    options?: ExtractOptions,
  ): ExtractedChapter {
    const { number, title } = this.detectChapterFromOpening(text, layout, { fallbackTitle });

    const safeTitle = this.isValidHeading(title, 'chapter')
      ? title
      : this.sanitizeHeading(fallbackTitle || 'Chapter 1', 'chapter');

    const chapter = {
      number,
      title: safeTitle,
      content: text,
      topics: [] as ExtractedTopic[],
    };
    chapter.topics = this.resolveTopicsForChapter(chapter, text, { ...options, pdfLayout: layout });
    return chapter;
  }

  /** Dedicated path for single-chapter PDF uploads. */
  private async extractSingleChapterDocument(
    text: string,
    options?: ExtractOptions,
  ): Promise<ExtractedChapter | null> {
    const fromOpening = this.detectChapterFromOpening(text, options?.pdfLayout, options);
    const layoutOk = fromOpening
      && this.isValidHeading(fromOpening.title, 'chapter')
      && !isInvalidChapterTitle(fromOpening.title);

    const aiTitle = await this.extractSingleChapterTitleWithAI(text, options);
    const aiOk = aiTitle
      && this.isValidHeading(aiTitle.title, 'chapter')
      && !isInvalidChapterTitle(aiTitle.title);

    if (aiOk && (!layoutOk || isGenericChapterLabel(fromOpening?.title ?? ''))) {
      this.logger.log(`Single chapter AI title: Ch${aiTitle!.number} "${aiTitle!.title}"`);
      const chapter = {
        number: aiTitle!.number,
        title: aiTitle!.title,
        content: text,
        topics: [] as ExtractedTopic[],
      };
      chapter.topics = this.resolveTopicsForChapter(chapter, text, options);
      return chapter;
    }

    if (layoutOk) {
      this.logger.log(`Single chapter detected from layout: Ch${fromOpening!.number} "${fromOpening!.title}"`);
      const chapter = {
        number: fromOpening!.number,
        title: fromOpening!.title,
        content: text,
        topics: [] as ExtractedTopic[],
      };
      chapter.topics = this.resolveTopicsForChapter(chapter, text, options);
      return chapter;
    }

    const fromFilename = this.detectChapterFromFilename(options);
    if (fromFilename && this.isValidHeading(fromFilename.title, 'chapter')) {
      this.logger.log(`Single chapter from filename: Ch${fromFilename.number} "${fromFilename.title}"`);
      const chapter = {
        number: fromFilename.number,
        title: fromFilename.title,
        content: text,
        topics: [] as ExtractedTopic[],
      };
      chapter.topics = this.resolveTopicsForChapter(chapter, text, options);
      return chapter;
    }

    const built = this.buildSingleChapter(text, options?.fallbackTitle, options?.pdfLayout, options);
    if (this.isValidHeading(built.title, 'chapter') && !isInvalidChapterTitle(built.title)) {
      this.logger.log(`Single chapter fallback title: "${built.title}"`);
      return built;
    }

    return null;
  }

  private detectChapterFromFilename(options?: ExtractOptions): { number: number; title: string } | null {
    if (!options?.fileName) return null;
    const parsed = parseChapterFromFilename(options.fileName);
    if (!parsed) return null;

    const hint = parsed.titleHint
      ? this.sanitizeHeading(parsed.titleHint.replace(/[-_]+/g, ' '), 'chapter')
      : '';
    const fallback = options.fallbackTitle
      ? this.sanitizeHeading(options.fallbackTitle, 'chapter')
      : '';
    const title = hint && this.isValidHeading(hint, 'chapter')
      ? hint
      : fallback && this.isValidHeading(fallback, 'chapter') && !isGenericChapterLabel(fallback)
        ? fallback
        : '';

    if (!title) return null;
    return { number: parsed.number, title };
  }

  /** Detect chapter number and title from the opening pages of a single-chapter PDF. */
  private detectChapterFromOpening(
    text: string,
    layout?: PdfExtractResult,
    options?: ExtractOptions,
  ): { number: number; title: string } {
    const ncert = parseNcertChapterOpening(text);
    if (ncert && this.isValidHeading(ncert.title, 'chapter') && !isInvalidChapterTitle(ncert.title)) {
      return ncert;
    }

    const openingText = text.slice(0, 4000);
    const openingLines = openingText.split('\n').map((l) => this.collapseSpacedLetters(l.trim())).filter(Boolean);

    let chapterNumber = options?.fileName
      ? (parseChapterFromFilename(options.fileName)?.number ?? 1)
      : 1;

    for (let i = 0; i < Math.min(openingLines.length, 35); i++) {
      const line = openingLines[i];

      const chapterOnly = line.match(/^(?:CHAPTER|Chapter)\s*[-:]?\s*(\d{1,2})\s*$/i);
      if (chapterOnly) {
        chapterNumber = parseInt(chapterOnly[1], 10);
        const mergedTitle = mergeTitleLines(openingLines, i + 1);
        if (mergedTitle) {
          const title = this.sanitizeHeading(mergedTitle, 'chapter');
          if (this.isValidHeading(title, 'chapter') && !isInvalidChapterTitle(title)) {
            return { number: chapterNumber, title };
          }
        }
        continue;
      }

      const numMatch = line.match(/^(?:CHAPTER|Chapter)\s*[-:]?\s*(\d{1,2})\b/i);
      if (numMatch) chapterNumber = parseInt(numMatch[1], 10);
    }

    const candidates: { line: string; score: number }[] = [];

    const headingPool = (layout?.headings ?? []).slice(0, 25);
    for (const h of headingPool) {
      if (isGenericChapterLabel(h)) continue;
      const score = this.scoreChapterTitleCandidate(h);
      if (score > 0) candidates.push({ line: h, score });
    }

    for (let i = 0; i < Math.min(openingLines.length, 35); i++) {
      if (isGenericChapterLabel(openingLines[i])) continue;
      const merged = mergeTitleLines(openingLines, i);
      if (!merged) continue;
      const score = this.scoreChapterTitleCandidate(merged);
      if (score > 0) candidates.push({ line: merged, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    for (const { line } of candidates) {
      const chapterLineMatch = line.match(/^(?:CHAPTER|Chapter)\s*[-:]?\s*(\d{1,2})\s*[-:.\s]+(.+)$/i);
      if (chapterLineMatch) {
        const num = parseInt(chapterLineMatch[1], 10);
        const title = this.sanitizeHeading(chapterLineMatch[2], 'chapter');
        if (this.isValidHeading(title, 'chapter') && !isInvalidChapterTitle(title)) {
          return { number: num, title };
        }
      }

      const title = this.sanitizeHeading(
        line.replace(/^(?:CHAPTER|Chapter)\s*\d+\s*[-:.\s]+/i, ''),
        'chapter',
      );
      if (this.isValidHeading(title, 'chapter') && !isInvalidChapterTitle(title)) {
        return { number: chapterNumber, title };
      }
    }

    const inferred = this.inferTitle(openingText, options?.fallbackTitle);
    return { number: chapterNumber, title: inferred };
  }

  private scoreChapterTitleCandidate(line: string): number {
    const collapsed = this.collapseSpacedLetters(line.trim());
    if (!collapsed || collapsed.length < 3) return 0;
    if (isGenericChapterLabel(collapsed)) return 0;

    let score = 0;

    if (/^(?:CHAPTER|Chapter)\s*\d+\s*[-:.\s]+\S/i.test(collapsed)) score += 100;

    const titlePart = collapsed.replace(/^(?:CHAPTER|Chapter)\s*\d+\s*[-:.\s]+/i, '').trim();
    const candidate = titlePart || collapsed;

    if (this.isMathOrFormulaLine(candidate)) return 0;
    if (this.isSubjectOnlyHeader(candidate)) return 0;
    if (this.isSentenceFragment(candidate)) return 0;
    if (isNcertPageHeaderLine(candidate)) return 0;
    if (this.isBoilerplateHeading(candidate)) return 0;

    const words = candidate.split(/\s+/);
    if (words.length >= 2 && words.length <= 14) score += 30;
    else if (words.length === 1 && candidate.length >= 4) score += 10;
    else if (words.length > 14) return 0;

    const alphaChars = (candidate.match(/[A-Za-z]/g) ?? []).length;
    const alphaRatio = alphaChars / candidate.length;
    if (alphaRatio > 0.75) score += 25;
    else if (alphaRatio > 0.5) score += 10;
    else return 0;

    const alphaWords = words.filter((w) => /[A-Za-z]{2,}/.test(w));
    if (alphaWords.length >= 2) score += 20;

    if (/^[A-Z]/.test(candidate)) score += 5;

    return score;
  }

  private async extractSingleChapterTitleWithAI(
    text: string,
    options?: ExtractOptions,
  ): Promise<{ number: number; title: string } | null> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) return null;

    const baseUrl = this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const model = this.config.get('OPENAI_MODEL') || 'gpt-4o-mini';

    const opening = text.slice(0, 5000);
    const headingHints = (options?.pdfLayout?.headings ?? []).slice(0, 15).join('\n');
    const fileHint = options?.fileName ? `Filename: ${options.fileName}` : '';
    const isMathOrScience = /math|science|physics|chemistry|biology/i.test(options?.subjectName ?? '');

    const mathRules = isMathOrScience
      ? `This is a MATH/SCIENCE chapter PDF. The title is a descriptive English name (2-6 words) like "Real Numbers" or "Polynomials".
Do NOT return equations (x + y = 20), number sequences (1 1 2), or the subject name alone (Mathematics).
Look for the bold/large heading on the first page.`
      : '';

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: `You identify the main chapter title from a single-chapter school textbook PDF.
Return ONLY a short heading (2-8 words). Never return "CHAPTER" alone, equations, formulas, page numbers, subject names alone, or quote attributions.
${mathRules}`,
            },
            {
              role: 'user',
              content: `Subject: ${options?.subjectName ?? 'Unknown'}, Class: ${options?.classLevel ?? 'Unknown'}
${fileHint}

DETECTED HEADINGS (bold/large font — prefer these):
${headingHints || '(none)'}

OPENING TEXT:
${opening}

Return JSON: { "number": 1, "title": "chapter title only" }`,
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) return null;

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const parsed = JSON.parse(data.choices[0].message.content) as { number?: number; title?: string };
      if (!parsed.title?.trim()) return null;

      return {
        number: parsed.number && parsed.number > 0 ? parsed.number : 1,
        title: this.sanitizeHeading(parsed.title, 'chapter'),
      };
    } catch {
      return null;
    }
  }

  private inferTitle(text: string, fallback?: string): string {
    const lines = text.split('\n').map((l) => this.collapseSpacedLetters(l.trim())).filter(Boolean);
    for (const line of lines.slice(0, 30)) {
      const chapterMatch = line.match(/^(?:CHAPTER|Chapter)\s*\d+\s*[-:.\s]+(.+)$/i);
      if (chapterMatch?.[1]) {
        const t = this.sanitizeHeading(chapterMatch[1], 'chapter');
        if (this.isValidHeading(t, 'chapter')) return t;
      }

      const score = this.scoreChapterTitleCandidate(line);
      if (score >= 40) {
        const t = this.sanitizeHeading(line, 'chapter');
        if (this.isValidHeading(t, 'chapter')) return t;
      }
    }
    return this.sanitizeHeading(fallback || 'Chapter 1', 'chapter');
  }

  private dedupeByNumber<T extends { number: number; index: number }>(matches: T[]): T[] {
    const byNumber = new Map<number, T>();
    for (const m of matches.sort((a, b) => a.index - b.index)) {
      if (!byNumber.has(m.number)) byNumber.set(m.number, m);
    }
    return [...byNumber.values()].sort((a, b) => a.index - b.index);
  }

  private isNoiseHeading(title: string): boolean {
    if (isGenericChapterLabel(title)) return true;
    if (this.isBoilerplateHeading(title)) return true;
    if (this.isMathOrFormulaLine(title)) return true;
    if (this.isSubjectOnlyHeader(title)) return true;
    if (this.isSentenceFragment(title)) return true;
    if (isNcertPageHeaderLine(title)) return true;
    const lower = title.toLowerCase();
    const noise = [
      'fig', 'figure', 'table', 'page', 'exercise', 'activity', 'summary',
      'keywords', 'review', 'question', 'answer', 'note', 'box', 'do you know',
      'let us', 'think about', 'project', 'appendix', 'bibliography', 'reprint',
    ];
    return noise.some((n) => lower.startsWith(n) || lower.includes(` ${n} `));
  }
}
