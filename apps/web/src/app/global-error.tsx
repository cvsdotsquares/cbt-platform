'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-sans text-center">
        <h1 className="text-2xl font-bold">NCERT Institute</h1>
        <p className="text-muted-foreground">A critical error occurred. Please reload the page.</p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Try again
        </button>
        {process.env.NODE_ENV !== 'production' && (
          <pre className="mt-4 max-w-lg overflow-auto rounded bg-gray-100 p-4 text-left text-xs">
            {error.message}
          </pre>
        )}
      </body>
    </html>
  );
}
