'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface QuestionInputProps {
  question: {
    id: string;
    type: string;
    content?: { text?: string };
    title?: string;
    options?: Record<string, string>;
    marks?: number;
  };
  answer: string | string[] | undefined;
  onSave: (value: string | string[]) => void;
}

function SyncedTextarea({
  value,
  onSave,
  ...props
}: {
  value: string;
  onSave: (value: string) => void;
} & React.ComponentProps<typeof Textarea>) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value, props.placeholder]);

  return (
    <Textarea
      {...props}
      value={local}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        onSave(next);
      }}
      onBlur={(e) => onSave(e.target.value)}
    />
  );
}

export function QuestionInput({ question, answer, onSave }: QuestionInputProps) {
  const type = question.type;

  if (type === 'MCQ' || type === 'MSQ') {
    const isMsq = type === 'MSQ';
    const options = question.options ?? {};
    return (
      <div className="space-y-3">
        {Object.entries(options).map(([key, label]) => {
          const selected = isMsq
            ? ((answer as string[]) || []).includes(key)
            : answer === key;
          return (
            <label
              key={key}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
            >
              <input
                type={isMsq ? 'checkbox' : 'radio'}
                name={question.id}
                checked={selected}
                onChange={() => {
                  if (isMsq) {
                    const current = (answer as string[]) || [];
                    const next = selected ? current.filter((k) => k !== key) : [...current, key];
                    onSave(next);
                  } else {
                    onSave(key);
                  }
                }}
              />
              <span>{key.toUpperCase()}. {label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (type === 'NUMERICAL') {
    return (
      <Input
        type="number"
        step="any"
        placeholder="Enter your numerical answer"
        value={(answer as string) ?? ''}
        onChange={(e) => onSave(e.target.value)}
        onBlur={(e) => { if (e.target.value) onSave(e.target.value); }}
        className="max-w-xs"
      />
    );
  }

  if (type === 'SUBJECTIVE' || type === 'CASE_STUDY') {
    return (
      <SyncedTextarea
        placeholder="Type your answer here..."
        rows={8}
        value={(answer as string) ?? ''}
        onSave={onSave}
      />
    );
  }

  if (type === 'CODING') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Write your code solution below.</p>
        <SyncedTextarea
          placeholder="// Your code here..."
          rows={12}
          className="font-mono text-sm"
          value={(answer as string) ?? ''}
          onSave={onSave}
        />
      </div>
    );
  }

  if (type === 'AUDIO' || type === 'VIDEO') {
    const content = question.content as { text?: string; mediaUrl?: string } | undefined;
    const mediaUrl = content?.mediaUrl;
    const acknowledged = answer === 'acknowledged';

    return (
      <div className="space-y-4">
        {content?.text && <p className="text-sm">{content.text}</p>}
        {mediaUrl ? (
          type === 'AUDIO' ? (
            <audio controls className="w-full" src={mediaUrl} />
          ) : (
            <video controls className="w-full max-h-80 rounded-lg" src={mediaUrl} />
          )
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No media attached to this question. Listen/read the instructions above and confirm when ready.
          </p>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onSave(e.target.checked ? 'acknowledged' : '')}
          />
          I have {type === 'AUDIO' ? 'listened to' : 'watched'} the content and am ready to proceed
        </label>
      </div>
    );
  }

  return (
    <SyncedTextarea
      placeholder="Type your answer..."
      rows={4}
      value={(answer as string) ?? ''}
      onSave={onSave}
    />
  );
}
