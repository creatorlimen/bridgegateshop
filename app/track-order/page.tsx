import type { Metadata } from 'next';
import { LockKeyhole, Search } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Track an order',
  robots: {
    index: false,
    follow: false,
  },
};

export default function TrackOrderPage() {
  return (
    <div className="shell py-16">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <p className="eyebrow justify-center text-clay">Secure tracking</p>
          <h1 className="display-type mt-5 text-balance text-5xl sm:text-6xl">
            Follow the order, not a guess.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-muted">
            Operational tracking will require the order reference plus a
            matching phone number or email. A reference alone never exposes an
            order.
          </p>
        </div>
        <form className="mt-9 rounded-[2rem] border border-ink/10 bg-paper p-6 shadow-card sm:p-9">
          <label className="grid gap-2 text-sm font-black">
            Order reference
            <input
              className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal uppercase"
              placeholder="BGS-26-XXXXXXX"
              type="text"
            />
          </label>
          <label className="mt-5 grid gap-2 text-sm font-black">
            Matching phone number or email
            <input
              className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
              placeholder="+234... or you@example.com"
              type="text"
            />
          </label>
          <button
            className="mt-6 flex min-h-14 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-ink/15 px-5 text-sm font-black text-ink/45"
            disabled
            type="button"
          >
            <Search aria-hidden="true" size={17} />
            Tracking connection pending
          </button>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
            <LockKeyhole
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={14}
            />
            Mismatched and unknown orders will use the same generic response
            and rate-limit behaviour.
          </p>
        </form>
      </div>
    </div>
  );
}
