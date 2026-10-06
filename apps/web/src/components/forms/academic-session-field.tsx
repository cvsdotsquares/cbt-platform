'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { academicSessionOptions } from '@/lib/academic-session';

type AcademicSessionFieldProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  extraOptions?: string[];
  disabled?: boolean;
};

export function AcademicSessionField({
  id = 'academic-session',
  label = 'Academic session',
  value,
  onChange,
  extraOptions = [],
  disabled,
}: AcademicSessionFieldProps) {
  const options = useMemo(
    () => academicSessionOptions([...extraOptions, value]),
    [extraOptions, value],
  );
  const isPreset = value === '' || options.includes(value);
  const [customMode, setCustomMode] = useState(!isPreset && value.length > 0);

  const selectValue = (customMode || (!isPreset && value))
    ? '__custom__'
    : (value || options[0] || '');

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '__custom__') {
            setCustomMode(true);
            if (isPreset && value) onChange(value);
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
      >
        {options.map((session) => (
          <option key={session} value={session}>{session}</option>
        ))}
        <option value="__custom__">Custom session…</option>
      </select>
      {(customMode || selectValue === '__custom__') && (
        <Input
          placeholder="e.g. 2026-27"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
