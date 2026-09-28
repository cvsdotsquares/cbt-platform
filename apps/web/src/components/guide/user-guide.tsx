'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen, CheckCircle2, ChevronDown, CircleHelp, Lightbulb, ListOrdered, ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';
import type { RoleGuide } from './guide-content';

type UserGuideProps = {
  guide: RoleGuide;
  /** When false, skip PageHeader (e.g. candidate help page with its own chrome). */
  showHeader?: boolean;
};

export function UserGuide({ guide, showHeader = true }: UserGuideProps) {
  const [openSection, setOpenSection] = useState<string | null>(guide.sections[0]?.id ?? null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="space-y-8">
      {showHeader && (
        <PageHeader
          title={guide.title}
          highlight={guide.highlight}
          description={guide.summary}
          badge={guide.badge}
        />
      )}

      {!showHeader && (
        <div className="space-y-2">
          <Badge>{guide.badge}</Badge>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {guide.title.split(' ').slice(0, -1).join(' ')}{' '}
            <span className="gradient-text">{guide.highlight}</span>
          </h1>
          <p className="max-w-2xl text-muted-foreground">{guide.summary}</p>
        </div>
      )}

      <Card className="surface-card border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ListOrdered className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{guide.workflowTitle}</CardTitle>
              <CardDescription>Follow this order for the smoothest experience</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-2">
            {guide.workflow.map((item, index) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/80 px-3.5 py-3"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="text-sm leading-snug">{item}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            How each area works
          </h2>
        </div>

        {guide.sections.map((section) => {
          const open = openSection === section.id;
          return (
            <Card key={section.id} className="surface-card overflow-hidden">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 p-5 text-left transition-colors hover:bg-muted/30"
                onClick={() => setOpenSection(open ? null : section.id)}
                aria-expanded={open}
              >
                <div className="space-y-1">
                  <p className="font-semibold">{section.title}</p>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
                <ChevronDown
                  className={cn(
                    'mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-180',
                  )}
                />
              </button>
              {open && (
                <CardContent className="space-y-4 border-t border-border/50 pb-5 pt-4">
                  {section.steps.map((step) => (
                    <div key={step.title} className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-sm font-semibold">{step.title}</p>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                        {step.tip && (
                          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {step.tip}
                          </p>
                        )}
                        {step.href && step.hrefLabel && (
                          <Button asChild variant="outline" size="sm" className="mt-1">
                            <Link href={step.href}>
                              {step.hrefLabel}
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CircleHelp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Common questions
          </h2>
        </div>

        <div className="space-y-2">
          {guide.faqs.map((faq, index) => {
            const open = openFaq === index;
            return (
              <Card key={faq.question} className="surface-card overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30"
                  onClick={() => setOpenFaq(open ? null : index)}
                  aria-expanded={open}
                >
                  <span className="text-sm font-semibold">{faq.question}</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </button>
                {open && (
                  <div className="border-t border-border/50 px-5 py-4 text-sm text-muted-foreground">
                    {faq.answer}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
