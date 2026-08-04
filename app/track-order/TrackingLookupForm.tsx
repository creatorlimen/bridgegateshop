'use client';

import { useActionState } from 'react';
import { Clock3, LockKeyhole, Search } from 'lucide-react';

import {
  initialTrackingActionState,
  lookupOrderTrackingAction,
} from '@/app/track-order/actions';

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

export function TrackingLookupForm({ defaultReference = '' }: { defaultReference?: string }) {
  const [state, formAction, pending] = useActionState(
    lookupOrderTrackingAction,
    initialTrackingActionState,
  );

  return (
    <div className="mt-9 grid gap-6">
      <form
        action={formAction}
        className="rounded-[2rem] border border-ink/10 bg-paper p-6 shadow-card sm:p-9"
      >
        <label className="grid gap-2 text-sm font-black">
          Order reference
          <input
            autoComplete="off"
            className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal uppercase"
            defaultValue={defaultReference}
            maxLength={32}
            name="reference"
            placeholder="BGS-XXXXXXXXXXXXXXXX"
            required
            type="text"
          />
        </label>
        <label className="mt-5 grid gap-2 text-sm font-black">
          Matching phone number or email
          <input
            autoComplete="email"
            className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
            maxLength={320}
            name="factor"
            placeholder="+234... or you@example.com"
            required
            type="text"
          />
        </label>
        <button
          className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          <Search aria-hidden="true" size={17} />
          {pending ? 'Checking securely…' : 'Check order progress'}
        </button>
        {state.message ? (
          <p aria-live="polite" className="mt-4 rounded-xl bg-clay/10 p-3 text-sm font-bold text-clay">
            {state.message}
          </p>
        ) : null}
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
          <LockKeyhole aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
          Unknown references and mismatched details receive the same private response.
        </p>
      </form>

      {state.result ? (
        <section aria-live="polite" className="rounded-[2rem] border border-ink/10 bg-ink p-6 text-white shadow-card sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sand">
            {state.result.reference}
          </p>
          <h2 className="display-type mt-3 text-4xl">{state.result.statusLabel}</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            {state.result.destinationLabel} · {state.result.estimate.label}
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-white/55">
            <Clock3 aria-hidden="true" size={14} />
            Operational updates only — this is not live GPS tracking.
          </p>
          <ol className="mt-7 grid gap-4 border-l border-white/15 pl-5">
            {state.result.timeline.length > 0 ? (
              state.result.timeline.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[1.55rem] top-1.5 size-2.5 rounded-full bg-sand" />
                  <p className="font-black">{event.label}</p>
                  <p className="mt-1 text-xs text-white/55">{formatEventTime(event.occurredAt)}</p>
                  {event.note ? <p className="mt-2 text-sm text-white/75">{event.note}</p> : null}
                </li>
              ))
            ) : (
              <li className="text-sm text-white/70">Your order is confirmed and awaiting its next operational update.</li>
            )}
          </ol>
          {state.result.supportWhatsappUrl ? (
            <a
              className="mt-7 inline-flex min-h-11 items-center rounded-full border border-white/25 px-5 text-sm font-black hover:bg-white hover:text-ink"
              href={state.result.supportWhatsappUrl}
              rel="noreferrer"
              target="_blank"
            >
              Ask about this order on WhatsApp
            </a>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
