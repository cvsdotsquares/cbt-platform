'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { materialsApi } from '@/lib/api';

type Props = {
  accessToken: string;
  materialId: string;
  mimeType?: string;
  title: string;
};

export function MaterialDocumentPreview({ accessToken, materialId, mimeType, title }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    setObjectUrl(null);
    setError(null);
    materialsApi
      .createFileObjectUrl(accessToken, materialId)
      .then((url) => {
        revoked = url;
        setObjectUrl(url);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not load preview');
      });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [accessToken, materialId]);

  if (error) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
        {error}
      </p>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading preview…
      </div>
    );
  }

  const isPdf = (mimeType ?? '').includes('pdf') || title.toLowerCase().endsWith('.pdf');
  const isImage = (mimeType ?? '').startsWith('image/');

  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={objectUrl}
        alt={title}
        className="max-h-[min(70vh,520px)] w-full rounded-lg border object-contain bg-muted/20"
      />
    );
  }

  if (isPdf) {
    return (
      <iframe
        src={objectUrl}
        title={title}
        className="h-[min(70vh,520px)] w-full rounded-lg border bg-muted/10"
      />
    );
  }

  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
      <p className="text-muted-foreground">Preview is not available for this file type.</p>
      <button
        type="button"
        className="mt-2 font-medium text-primary hover:underline"
        onClick={() => void materialsApi.openFile(accessToken, materialId)}
      >
        Open file
      </button>
    </div>
  );
}
