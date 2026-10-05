'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { getDisplayErrorMessage } from '@/lib/format-error-message';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  const message = getDisplayErrorMessage(error);
  const hasDetail = message !== 'Something went wrong';

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="max-w-lg text-xl font-semibold">{hasDetail ? message : 'Something went wrong'}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {hasDetail
          ? 'Try again or return to the home page if the problem continues.'
          : 'An unexpected error occurred. Please try again or return to the home page.'}
      </p>
      {error.digest && (
        <p className="text-[11px] text-muted-foreground/70">Reference: {error.digest}</p>
      )}
      <div className="flex gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" onClick={() => { window.location.href = '/'; }}>
          Go home
        </Button>
      </div>
    </div>
  );
}
