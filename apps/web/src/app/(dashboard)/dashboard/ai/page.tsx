'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { aiApi, questionsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Sparkles, Brain, Wand2, Zap, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react';

type GeneratedQuestion = {
  title: string;
  content: { text: string };
  options: Record<string, string>;
  correctAnswer: { value: string | string[] };
  type: string;
  difficulty: string;
  marks: number;
  negativeMarks: number;
};

export default function AiStudioPage() {
  const { accessToken } = useRequireAuth(true);
  const [topic, setTopic] = useState('General Aptitude');
  const [count, setCount] = useState(3);
  const [difficulty, setDifficulty] = useState('MEDIUM');
  const [questionType, setQuestionType] = useState<'MCQ' | 'MSQ'>('MCQ');
  const [generated, setGenerated] = useState<{
    questions: GeneratedQuestion[];
    source: string;
    message?: string;
  } | null>(null);

  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => aiApi.status(accessToken!) as Promise<{ openaiConfigured: boolean; model: string }>,
    enabled: !!accessToken,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      aiApi.generateQuestions(accessToken!, {
        topic,
        count,
        difficulty,
        type: questionType,
      }) as Promise<{ questions: GeneratedQuestion[]; source: string; message?: string }>,
    onSuccess: (data) => {
      setGenerated(data);
      const sourceLabel = data.source === 'openai' ? 'OpenAI GPT' : 'Template fallback';
      toast({
        title: data.source === 'openai' ? 'Questions generated with OpenAI' : 'Questions generated (fallback)',
        description: data.message || sourceLabel,
        variant: data.source === 'openai' ? 'success' : 'default',
      });
    },
    onError: (e: Error) => toast({ title: 'Generation failed', description: e.message, variant: 'destructive' }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!generated?.questions) return;
      for (const q of generated.questions) {
        await questionsApi.create(accessToken!, {
          title: q.title,
          type: q.type || questionType,
          difficulty: q.difficulty || difficulty,
          content: q.content,
          options: q.options,
          correctAnswer: q.correctAnswer,
          marks: q.marks || 2,
          negativeMarks: q.negativeMarks || 0,
        });
      }
    },
    onSuccess: () => toast({ title: 'Saved to Question Bank', variant: 'success' }),
  });

  const isCorrectOption = (key: string, correct: string | string[]) =>
    Array.isArray(correct) ? correct.includes(key) : correct === key;

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Studio"
        highlight="Studio"
        description="Generate questions with OpenAI, analyze exams, and power intelligent proctoring"
        badge="AI Powered"
      />

      {aiStatus && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 ${
            aiStatus.openaiConfigured
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-amber-500/30 bg-amber-500/5'
          }`}
        >
          {aiStatus.openaiConfigured ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          )}
          <div className="space-y-1">
            <p className="font-semibold">
              {aiStatus.openaiConfigured
                ? `OpenAI connected (${aiStatus.model})`
                : 'OpenAI not configured — using template fallback'}
            </p>
            <p className="text-sm text-muted-foreground">
              {aiStatus.openaiConfigured
                ? 'Questions are generated live by GPT based on your topic, difficulty, and type.'
                : 'Add OPENAI_API_KEY to apps/api/.env or the root .env, then restart the API server to enable real AI generation.'}
            </p>
          </div>
        </div>
      )}

      <div className="hero-banner">
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15">
            <Sparkles className="h-7 w-7 text-violet-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Intelligent Exam Content Engine</h3>
            <p className="text-sm text-muted-foreground">
              Generate original MCQ and MSQ questions on any topic using OpenAI GPT.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: Wand2, title: 'Question Generator', desc: 'MCQ & MSQ from any topic', color: 'text-violet-600 bg-violet-500/10' },
          { icon: Brain, title: 'Exam Insights', desc: 'AI performance analysis', color: 'text-blue-600 bg-blue-500/10' },
          { icon: Zap, title: 'Smart Proctoring', desc: 'Real-time risk scoring', color: 'text-amber-600 bg-amber-500/10' },
        ].map((f) => (
          <Card key={f.title} className="surface-card">
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${f.color}`}>
                <f.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="surface-card border-violet-500/20">
        <CardHeader className="border-b border-border/60">
          <CardTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
              <Sparkles className="h-4 w-4 text-violet-600" />
            </div>
            AI Question Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2 lg:col-span-2">
              <Label>Topic</Label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="JavaScript, Data Structures, Aptitude..."
              />
            </div>
            <div className="space-y-2">
              <Label>Count</Label>
              <Input type="number" min={1} max={10} value={count} onChange={(e) => setCount(+e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <select className="form-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                className="form-select"
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value as 'MCQ' | 'MSQ')}
              >
                <option value="MCQ">MCQ (single answer)</option>
                <option value="MSQ">MSQ (multiple answers)</option>
              </select>
            </div>
          </div>

          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !topic.trim()}
            className="w-full sm:w-auto"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {generateMutation.isPending ? 'Generating with AI...' : 'Generate Questions'}
          </Button>

          {generated && (
            <div className="space-y-4 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={generated.source === 'openai' ? 'default' : 'secondary'}>
                    {generated.source === 'openai' ? 'OpenAI GPT' : 'Template Fallback'}
                  </Badge>
                  {generated.message && generated.source !== 'openai' && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {generated.message}
                    </span>
                  )}
                </div>
                <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {saveMutation.isPending ? 'Saving...' : 'Save All to Question Bank'}
                </Button>
              </div>
              {generated.questions.map((q, i) => (
                <Card key={i} className="border border-border/60 bg-muted/20">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{q.title}</p>
                      <Badge variant="outline" className="text-xs">
                        {q.type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm">{q.content.text}</p>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                      {Object.entries(q.options).map(([k, v]) => (
                        <span
                          key={k}
                          className={isCorrectOption(k, q.correctAnswer.value) ? 'font-semibold text-primary' : ''}
                        >
                          {k.toUpperCase()}. {v}
                          {isCorrectOption(k, q.correctAnswer.value) ? ' ✓' : ''}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
