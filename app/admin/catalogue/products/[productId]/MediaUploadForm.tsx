'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type ApiResult<Data> =
  | {
      ok: true;
      data: Data;
      requestId: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      requestId: string;
    };

type UploadIntent = {
  uploadIntentId: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: {
    'Content-Type': string;
  };
};

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const body = (await response.json()) as {
    csrfToken?: string;
  };

  if (!response.ok || !body.csrfToken) {
    throw new Error('Unable to secure the upload request.');
  }

  return body.csrfToken;
}

export function MediaUploadForm({
  productId,
}: {
  productId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<
    'idle' | 'preparing' | 'uploading' | 'processing' | 'complete'
  >('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get('file');
    const altText = String(formData.get('altText') ?? '').trim();

    if (!(file instanceof File) || file.size === 0) {
      setMessage('Choose an image to upload.');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setMessage('Product images must be 8 MB or smaller.');
      return;
    }

    try {
      setStatus('preparing');
      const csrfToken = await getCsrfToken();
      const intentResponse = await fetch('/api/uploads/intents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          productId,
          fileName: file.name,
          mimeType: file.type,
          bytes: file.size,
          altText,
        }),
      });
      const intentResult =
        (await intentResponse.json()) as ApiResult<UploadIntent>;

      if (!intentResult.ok) {
        throw new Error(
          `${intentResult.message} Reference: ${intentResult.requestId}`,
        );
      }

      setStatus('uploading');
      const storageResponse = await fetch(
        intentResult.data.uploadUrl,
        {
          method: 'PUT',
          headers: intentResult.data.requiredHeaders,
          body: file,
        },
      );

      if (!storageResponse.ok) {
        throw new Error('The secure storage upload did not complete.');
      }

      setStatus('processing');
      const finaliseResponse = await fetch('/api/uploads/finalise', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          uploadIntentId: intentResult.data.uploadIntentId,
        }),
      });
      const finaliseResult =
        (await finaliseResponse.json()) as ApiResult<{
          mediaId: string;
        }>;

      if (!finaliseResult.ok) {
        throw new Error(
          `${finaliseResult.message} Reference: ${finaliseResult.requestId}`,
        );
      }

      setStatus('complete');
      setMessage('Image validated and derivatives created.');
      form.reset();
      router.refresh();
    } catch (error) {
      setStatus('idle');
      setMessage(
        error instanceof Error
          ? error.message
          : 'The image upload could not be completed.',
      );
    }
  }

  return (
    <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-xs font-black">
        Image
        <input
          accept="image/avif,image/jpeg,image/png,image/webp"
          className="rounded-xl border border-ink/15 bg-canvas px-4 py-3 text-sm"
          disabled={status !== 'idle' && status !== 'complete'}
          name="file"
          required
          type="file"
        />
      </label>
      <label className="grid gap-2 text-xs font-black">
        Descriptive alt text
        <input
          className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 text-sm"
          disabled={status !== 'idle' && status !== 'complete'}
          maxLength={300}
          minLength={3}
          name="altText"
          required
        />
      </label>
      <button
        className="button-dark"
        disabled={status !== 'idle' && status !== 'complete'}
        type="submit"
      >
        {status === 'preparing'
          ? 'Preparing secure upload…'
          : status === 'uploading'
            ? 'Uploading…'
            : status === 'processing'
              ? 'Validating and resizing…'
              : 'Upload product image'}
      </button>
      {message ? (
        <p
          className="rounded-xl bg-canvas p-3 text-xs leading-5"
          role={status === 'complete' ? 'status' : 'alert'}
        >
          {message}
        </p>
      ) : null}
      <p className="text-[0.7rem] leading-5 text-muted">
        JPEG, PNG, WebP, or AVIF; maximum 8 MB and 40 megapixels. Files are
        quarantined and signature-checked before publication.
      </p>
    </form>
  );
}
