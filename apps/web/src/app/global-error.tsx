'use client';

import { getDisplayErrorMessage } from '@/lib/format-error-message';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = getDisplayErrorMessage(error, 'A critical error occurred. Please reload the page.');

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-sans text-center">
        <h1 className="text-2xl font-bold">NCERT Institute</h1>
        <p className="max-w-md text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Try again
        </button>
        {error.digest && (
          <p className="text-xs text-gray-500">Reference: {error.digest}</p>
        )}
      </body>
    </html>
  );
}
