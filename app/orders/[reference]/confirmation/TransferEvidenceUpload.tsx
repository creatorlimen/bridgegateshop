'use client';

import { useState, type FormEvent } from 'react';

async function csrfToken() {
  const response = await fetch('/api/auth/csrf', { cache: 'no-store', credentials: 'same-origin' });
  const body = (await response.json()) as { csrfToken?: string };
  if (!response.ok || !body.csrfToken) throw new Error('Unable to secure the evidence upload.');
  return body.csrfToken;
}

export function TransferEvidenceUpload({ orderId }: { orderId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('file');
    if (!(file instanceof File) || !file.size) return;
    if (file.size > 5 * 1_024 * 1_024) return setMessage('Evidence must be 5 MB or smaller.');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return setMessage('Use PDF, JPEG, or PNG evidence.');
    setBusy(true);
    setMessage(null);
    try {
      const token = await csrfToken();
      const intentResponse = await fetch('/api/orders/transfer-evidence/intents', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ orderId, fileName: file.name, mimeType: file.type, bytes: file.size }),
      });
      const intent = await intentResponse.json() as { ok: boolean; message?: string; data?: { uploadIntentId: string; uploadUrl: string; requiredHeaders: Record<string, string> } };
      if (!intent.ok || !intent.data) throw new Error(intent.message ?? 'Evidence upload could not start.');
      const upload = await fetch(intent.data.uploadUrl, { method: 'PUT', headers: intent.data.requiredHeaders, body: file });
      if (!upload.ok) throw new Error('Secure storage upload failed.');
      const finaliseResponse = await fetch('/api/orders/transfer-evidence/finalise', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ uploadIntentId: intent.data.uploadIntentId }),
      });
      const finalised = await finaliseResponse.json() as { ok: boolean; message?: string; data?: { evidenceId: string } };
      if (!finalised.ok || !finalised.data) throw new Error(finalised.message ?? 'Evidence upload could not finish.');
      setMessage(`Evidence submitted securely. Reference: ${finalised.data.evidenceId}`);
      form.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Evidence upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-5 grid gap-3 border-t border-ink/10 pt-5" onSubmit={submit}>
      <label className="grid gap-2 text-xs font-black">Optional transfer evidence<input accept="application/pdf,image/jpeg,image/png" className="rounded-xl border border-ink/15 bg-canvas px-3 py-3 text-sm" disabled={busy} name="file" required type="file" /></label>
      <button className="rounded-full bg-ink px-4 py-3 text-xs font-black text-paper disabled:opacity-50" disabled={busy} type="submit">{busy ? 'Submitting evidence...' : 'Submit private evidence'}</button>
      {message ? <p className="text-xs leading-5 text-muted" role="status">{message}</p> : null}
      <p className="text-[0.68rem] leading-5 text-muted">Evidence is private, signature-checked, retention-limited, and never marks payment as successful.</p>
    </form>
  );
}
