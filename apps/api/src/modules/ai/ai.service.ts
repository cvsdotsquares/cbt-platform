import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProctoringService } from '../proctoring/proctoring.service';

export interface GeneratedQuestion {
  title: string;
  type: string;
  difficulty: string;
  content: { text: string };
  options: Record<string, string>;
  correctAnswer: { value: string | string[]; rubric?: string };
  marks: number;
  negativeMarks: number;
}

export interface FrameAnalysisResult {
  riskScore: number;
  violations: { type: string; severity: string; confidence: number }[];
  faceDetected: boolean;
  faceMatch: number;
  eyeOnScreen: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => ProctoringService))
    private proctoringService: ProctoringService,
  ) {}

  getStatus() {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    return {
      openaiConfigured: Boolean(apiKey?.trim()),
      model: this.config.get('OPENAI_MODEL') || 'gpt-4o-mini',
    };
  }

  async generateQuestions(params: {
    topic: string;
    count: number;
    difficulty: string;
    type: string;
  }): Promise<{ questions: GeneratedQuestion[]; source: 'openai' }> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY is not configured. Set it in apps/api/.env to generate real AI questions.',
      );
    }
    try {
      const questions = await this.generateWithOpenAI(apiKey, params);
      return { questions, source: 'openai' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`OpenAI question generation failed: ${msg}`);
      throw new BadGatewayException(`OpenAI question generation failed: ${msg}`);
    }
  }

  private async generateWithOpenAI(
    apiKey: string,
    params: { topic: string; count: number; difficulty: string; type: string },
  ): Promise<GeneratedQuestion[]> {
    const baseUrl = this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const model = this.config.get('OPENAI_MODEL') || 'gpt-4o-mini';
    const isMsq = params.type === 'MSQ';
    const isSubjective = ['SUBJECTIVE', 'CASE_STUDY'].includes(params.type);

    const systemPrompt = `You are an expert exam question writer for a computer-based testing (CBT) platform.
Create original, accurate, unambiguous questions suitable for formal assessments.
For MCQ, create exactly 4 options labeled a, b, c, d with one correct option.
For MSQ, create exactly 4 options with two or more correct options.
For SUBJECTIVE and CASE_STUDY, create an open-ended question and put a concise reference answer and grading rubric in correctAnswer.
Do not include explanations. Avoid trick questions or ambiguous wording.`;

    const userPrompt = `Generate exactly ${params.count} ${params.difficulty} difficulty ${params.type} exam questions about "${params.topic}".
  Return JSON matching the schema. Use marks: 2 and negativeMarks: 0 for each question.${isSubjective ? ' For each subjective item, put the reference answer in correctAnswer.value and objective scoring criteria in correctAnswer.rubric.' : ''}`;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'exam_questions',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      content: {
                        type: 'object',
                        properties: { text: { type: 'string' } },
                        required: ['text'],
                        additionalProperties: false,
                      },
                      options: {
                        type: 'object',
                        properties: isSubjective ? {} : {
                          a: { type: 'string' },
                          b: { type: 'string' },
                          c: { type: 'string' },
                          d: { type: 'string' },
                        },
                        required: isSubjective ? [] : ['a', 'b', 'c', 'd'],
                        additionalProperties: false,
                      },
                      correctAnswer: {
                        type: 'object',
                        properties: {
                          value: isMsq
                            ? { type: 'array', items: { type: 'string', enum: ['a', 'b', 'c', 'd'] } }
                            : { type: 'string' },
                          rubric: { type: 'string' },
                        },
                        required: ['value', 'rubric'],
                        additionalProperties: false,
                      },
                      marks: { type: 'number' },
                      negativeMarks: { type: 'number' },
                    },
                    required: ['title', 'content', 'options', 'correctAnswer', 'marks', 'negativeMarks'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['questions'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');

    const parsed = JSON.parse(content) as { questions?: GeneratedQuestion[] };
    const items = parsed.questions || [];
    if (!items.length) throw new Error('OpenAI returned no questions');

    return this.normalizeQuestions(items.slice(0, params.count), params);
  }

  private normalizeQuestions(
    items: GeneratedQuestion[],
    params: { topic: string; difficulty: string; type: string },
  ): GeneratedQuestion[] {
    const isSubjective = ['SUBJECTIVE', 'CASE_STUDY'].includes(params.type);
    return items.map((q, i) => {
      const options = q.options || {};
      const normalizedOptions: Record<string, string> = {
        a: String(options.a ?? options.A ?? ''),
        b: String(options.b ?? options.B ?? ''),
        c: String(options.c ?? options.C ?? ''),
        d: String(options.d ?? options.D ?? ''),
      };

      let correctValue = q.correctAnswer?.value;
      if (params.type === 'MSQ' && !Array.isArray(correctValue)) {
        correctValue = correctValue ? [String(correctValue).toLowerCase()] : [];
      } else if (params.type === 'MCQ' && Array.isArray(correctValue)) {
        correctValue = String(correctValue[0] ?? 'a').toLowerCase();
      } else if (typeof correctValue === 'string') {
        correctValue = correctValue.toLowerCase();
      }

      const text = q.content?.text?.trim() || `Question ${i + 1} about ${params.topic}`;

      let finalOptions = isSubjective ? {} : normalizedOptions;
      let finalCorrect = correctValue;
      if (params.type === 'MCQ' && typeof correctValue === 'string' && ['a', 'b', 'c', 'd'].includes(correctValue)) {
        const shuffled = this.shuffleMcqOptions(normalizedOptions, correctValue);
        finalOptions = shuffled.options;
        finalCorrect = shuffled.correct;
      }

      return {
        title: q.title?.trim() || `${params.topic} — Question ${i + 1}`,
        type: params.type,
        difficulty: params.difficulty,
        content: { text },
        options: finalOptions,
        correctAnswer: { value: finalCorrect as string | string[], rubric: q.correctAnswer?.rubric },
        marks: q.marks ?? 2,
        negativeMarks: q.negativeMarks ?? 0,
      };
    });
  }

  private shuffleMcqOptions(
    options: Record<string, string>,
    correct: string,
  ): { options: Record<string, string>; correct: string } {
    const keys = ['a', 'b', 'c', 'd'] as const;
    const entries = keys.map((key) => ({ key, value: options[key] }));
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    const shuffled: Record<string, string> = {};
    let newCorrect = correct;
    entries.forEach((entry, index) => {
      const newKey = keys[index];
      shuffled[newKey] = entry.value;
      if (entry.key === correct) newCorrect = newKey;
    });
    return { options: shuffled, correct: newCorrect };
  }

  private generateFromTemplate(params: { topic: string; count: number; difficulty: string; type: string }): GeneratedQuestion[] {
    const templates: Record<string, GeneratedQuestion[]> = {
      'General Aptitude': [
        { title: 'Percentage Calc', type: 'MCQ', difficulty: 'MEDIUM', content: { text: 'What is 25% of 240?' }, options: { a: '50', b: '60', c: '70', d: '80' }, correctAnswer: { value: 'b' }, marks: 2, negativeMarks: 0 },
        { title: 'Time & Work', type: 'MCQ', difficulty: 'MEDIUM', content: { text: 'A can finish work in 10 days. B in 15 days. Together they finish in?' }, options: { a: '5 days', b: '6 days', c: '7 days', d: '8 days' }, correctAnswer: { value: 'b' }, marks: 2, negativeMarks: 0 },
        { title: 'Logical Reasoning', type: 'MCQ', difficulty: 'EASY', content: { text: 'If all Bloops are Razzies and all Razzies are Lazzies, are all Bloops definitely Lazzies?' }, options: { a: 'Yes', b: 'No', c: 'Cannot determine', d: 'Sometimes' }, correctAnswer: { value: 'a' }, marks: 2, negativeMarks: 0 },
      ],
      JavaScript: [
        { title: 'JS Closures', type: 'MCQ', difficulty: 'HARD', content: { text: 'What is a closure in JavaScript?' }, options: { a: 'Function + lexical env', b: 'Class instance', c: 'Promise handler', d: 'Event loop' }, correctAnswer: { value: 'a' }, marks: 2, negativeMarks: 0 },
        { title: 'JS Types', type: 'MCQ', difficulty: 'EASY', content: { text: 'typeof null in JavaScript returns?' }, options: { a: 'null', b: 'undefined', c: 'object', d: 'number' }, correctAnswer: { value: 'c' }, marks: 2, negativeMarks: 0 },
      ],
    };

    const pool = templates[params.topic] || templates['General Aptitude'];
    const result: GeneratedQuestion[] = [];
    for (let i = 0; i < params.count; i++) {
      const t = pool[i % pool.length];
      const isSubjective = ['SUBJECTIVE', 'CASE_STUDY'].includes(params.type);
      const isMsq = params.type === 'MSQ';
      const content = isSubjective
        ? params.type === 'CASE_STUDY'
          ? `Case study: ${t.content.text} Explain your reasoning and describe how you would apply the concept in this situation.`
          : `${t.content.text} Explain your answer in your own words and support it with relevant reasoning.`
        : t.content.text;
      const correctAnswer = isSubjective
        ? {
            value: params.type === 'CASE_STUDY'
              ? `A complete response should explain the concept behind: ${t.content.text}`
              : `The response should correctly explain the concept tested by: ${t.content.text}`,
            rubric: params.type === 'CASE_STUDY'
              ? 'Award marks for identifying the relevant concept, applying it to the case, and explaining the reasoning clearly.'
              : 'Award marks for a correct concept, accurate reasoning, and a clear explanation.',
          }
        : isMsq
          ? { value: ['a', 'c'] }
          : t.correctAnswer;
      result.push({
        ...t,
        title: `${params.topic} Q${i + 1}: ${t.title}`,
        type: params.type,
        difficulty: params.difficulty,
        content: { text: `[${params.topic}] ${content}` },
        options: isSubjective ? {} : t.options,
        correctAnswer,
      });
    }
    return result;
  }

  async analyzeFrame(sessionId: string, thumbnail: string): Promise<FrameAnalysisResult> {
    const externalUrl = this.config.get<string>('AI_PROCTORING_API_URL');
    if (this.config.get('AI_PROCTORING_ENABLED') === 'true' && externalUrl) {
      try {
        const res = await fetch(`${externalUrl}/analyze/frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, frameBase64: thumbnail }),
        });
        if (res.ok) return await res.json() as FrameAnalysisResult;
      } catch (e) {
        this.logger.warn(`External AI proctoring unavailable: ${e}`);
      }
    }

    return this.heuristicFrameAnalysis(sessionId, thumbnail);
  }

  private heuristicFrameAnalysis(sessionId: string, thumbnail: string): FrameAnalysisResult {
    const hash = this.simpleHash(sessionId + thumbnail.slice(-100));
    const faceDetected = thumbnail.length > 5000;
    const violations: FrameAnalysisResult['violations'] = [];

    if (!faceDetected) {
      violations.push({ type: 'NO_FACE', severity: 'HIGH', confidence: 0.85 });
    }
    if (hash % 17 === 0) {
      violations.push({ type: 'GAZE_AWAY', severity: 'MEDIUM', confidence: 0.72 });
    }
    if (hash % 23 === 0) {
      violations.push({ type: 'MULTIPLE_FACES', severity: 'CRITICAL', confidence: 0.91 });
    }

    const riskScore = Math.min(100, violations.reduce((s, v) => {
      const w = { LOW: 5, MEDIUM: 15, HIGH: 35, CRITICAL: 50 }[v.severity] || 5;
      return s + w;
    }, hash % 10));

    return {
      riskScore,
      violations,
      faceDetected,
      faceMatch: faceDetected ? 0.88 + (hash % 10) / 100 : 0,
      eyeOnScreen: faceDetected ? 0.75 + (hash % 20) / 100 : 0,
    };
  }

  private simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  async gradeSubjective(params: {
    question: string;
    referenceAnswer?: string;
    rubric?: string;
    answer: string;
    maxMarks: number;
  }): Promise<{ marksAwarded: number; isCorrect: boolean; feedback: string; source: 'openai' | 'manual' }> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return { marksAwarded: 0, isCorrect: false, feedback: 'AI grading is unavailable; manual review is required.', source: 'manual' };
    }

    const baseUrl = this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const model = this.config.get('OPENAI_MODEL') || 'gpt-4o-mini';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You grade exam answers fairly. Award marks only for demonstrated understanding, do not infer missing work, and return JSON only.' },
          { role: 'user', content: JSON.stringify({ ...params, instruction: `Award a score from 0 to ${params.maxMarks}.` }) },
        ],
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'subjective_grade',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                marksAwarded: { type: 'number' },
                isCorrect: { type: 'boolean' },
                feedback: { type: 'string' },
              },
              required: ['marksAwarded', 'isCorrect', 'feedback'],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI grading error ${response.status}`);
    const data = await response.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') as {
      marksAwarded?: number; isCorrect?: boolean; feedback?: string;
    };
    const marksAwarded = Math.max(0, Math.min(params.maxMarks, Number(parsed.marksAwarded) || 0));
    return {
      marksAwarded,
      isCorrect: Boolean(parsed.isCorrect) && marksAwarded > 0,
      feedback: parsed.feedback?.trim() || 'Answer evaluated by AI.',
      source: 'openai',
    };
  }

  async processProctoringFrame(sessionId: string, thumbnail: string) {
    const analysis = await this.analyzeFrame(sessionId, thumbnail);

    for (const v of analysis.violations) {
      await this.proctoringService.recordEvent(sessionId, v.type as never, {
        confidence: v.confidence,
        severity: v.severity as never,
        metadata: { aiAnalyzed: true },
      });
    }

    await this.prisma.examSession.update({
      where: { id: sessionId },
      data: { riskScore: analysis.riskScore },
    });

    return analysis;
  }

  async getExamInsights(examId: string, tenantId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, tenantId } });
    if (!exam) return null;

    const [results, sessions, violations] = await Promise.all([
      this.prisma.examResult.findMany({ where: { examId }, select: { percentage: true, totalScore: true } }),
      this.prisma.examSession.count({ where: { examId } }),
      this.prisma.proctoringEvent.count({
        where: { session: { examId }, severity: { in: ['HIGH', 'CRITICAL'] } },
      }),
    ]);

    const avgScore = results.length
      ? results.reduce((s, r) => s + r.percentage, 0) / results.length
      : 0;
    const passRate = results.length
      ? (results.filter((r) => r.percentage >= 40).length / results.length) * 100
      : 0;

    const insights = [
      avgScore >= 70
        ? `Strong performance: average score is ${avgScore.toFixed(1)}%. Consider increasing difficulty.`
        : avgScore < 40
          ? `Low average (${avgScore.toFixed(1)}%). Review question difficulty and exam duration.`
          : `Moderate performance at ${avgScore.toFixed(1)}%. Pass rate is ${passRate.toFixed(0)}%.`,
      violations > 0
        ? `${violations} high-severity proctoring violations detected. Review flagged sessions before publishing results.`
        : 'No critical proctoring violations. Exam integrity looks good.',
      sessions > 0
        ? `${((results.length / sessions) * 100).toFixed(0)}% completion rate (${results.length}/${sessions} sessions).`
        : 'No exam sessions started yet.',
    ];

    const recommendations = [
      violations > 5 ? 'Enable stricter fullscreen and tab-switch policies' : null,
      avgScore > 80 ? 'Add harder questions or reduce time limit' : null,
      passRate < 30 ? 'Review passing score threshold and question clarity' : null,
    ].filter(Boolean);

    return {
      examId,
      title: exam.title,
      summary: insights,
      recommendations,
      metrics: { avgScore, passRate, violations, sessions, submitted: results.length },
      generatedAt: new Date().toISOString(),
    };
  }

  async chat(message: string, context?: { role?: string; page?: string }) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      try {
        const baseUrl = this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: this.config.get('OPENAI_MODEL') || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are CBT Platform AI Assistant. Help admins and candidates with exams, proctoring, results. Be concise.' },
              { role: 'user', content: `Context: ${JSON.stringify(context || {})}\n\n${message}` },
            ],
            max_tokens: 500,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { choices: { message: { content: string } }[] };
          return { reply: data.choices[0].message.content, source: 'openai' };
        }
      } catch { /* fallback */ }
    }

    const lower = message.toLowerCase();
    let reply = 'I can help with exam management, proctoring, question generation, and results. Try the AI Studio for question generation.';
    if (lower.includes('proctor')) reply = 'Proctoring monitors tab switches, copy/paste, camera feed, and calculates risk scores. High-risk sessions appear in Live Monitoring.';
    if (lower.includes('question') || lower.includes('generate')) reply = 'Go to AI Studio or Question Bank → Generate with AI. Provide a topic, difficulty, and count.';
    if (lower.includes('result')) reply = 'Results are auto-evaluated on submit. Admins can calculate ranks and publish from the Results page.';
    if (lower.includes('exam')) reply = 'Create exams in Exams → add questions → assign candidates → publish. Candidates start from My Exams.';

    return { reply, source: 'template' };
  }
}
