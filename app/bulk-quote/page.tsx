import type { Metadata } from 'next';
import { ArrowRight, CheckCircle2, Clock3 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Bulk quote request',
  description:
    'Prepare a structured request for larger building finishing material orders.',
};

const quoteBenefits = [
  'One durable reference for the request',
  'Products, quantities, location, and timeline together',
  'Sales workflow designed for a response within 24 hours',
];

export default function BulkQuotePage() {
  return (
    <div className="shell py-12 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[0.72fr_1fr] lg:gap-16">
        <div>
          <p className="eyebrow text-clay">Bulk quote</p>
          <h1 className="display-type mt-5 text-balance text-5xl leading-[0.98] sm:text-6xl">
            Structure the request before the call.
          </h1>
          <p className="mt-5 text-base leading-7 text-muted">
            For contractors, distributors, and project teams ordering at
            volume. This interface is ready for the durable quote service and
            notification outbox.
          </p>
          <ul className="mt-8 grid gap-4">
            {quoteBenefits.map((quoteBenefit) => (
              <li className="flex gap-3 text-sm font-bold" key={quoteBenefit}>
                <CheckCircle2
                  aria-hidden="true"
                  className="shrink-0 text-moss"
                  size={19}
                />
                {quoteBenefit}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex items-start gap-4 rounded-2xl bg-amber/20 p-5">
            <Clock3 aria-hidden="true" className="shrink-0 text-clay" size={22} />
            <div>
              <p className="text-sm font-black">Response aim</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Specta aims to respond within 24 hours after a valid request.
              </p>
            </div>
          </div>
        </div>

        <form className="rounded-[2rem] border border-ink/10 bg-paper p-6 shadow-card sm:p-9">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-black">
              Full name
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="Your full name"
                type="text"
              />
            </label>
            <label className="grid gap-2 text-sm font-black">
              Company <span className="font-normal text-muted">(optional)</span>
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="Company or project"
                type="text"
              />
            </label>
            <label className="grid gap-2 text-sm font-black">
              Phone number
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="+234..."
                type="tel"
              />
            </label>
            <label className="grid gap-2 text-sm font-black">
              Email address
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="you@example.com"
                type="email"
              />
            </label>
            <label className="grid gap-2 text-sm font-black sm:col-span-2">
              Products and estimated quantities
              <textarea
                className="min-h-28 rounded-xl border border-ink/15 bg-canvas p-4 font-normal"
                placeholder="List the materials, pack sizes, and quantities you need."
              />
            </label>
            <label className="grid gap-2 text-sm font-black">
              Project location
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                placeholder="Area in Lagos"
                type="text"
              />
            </label>
            <label className="grid gap-2 text-sm font-black">
              Required timeline
              <input
                className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
                type="date"
              />
            </label>
          </div>
          <label className="mt-6 flex items-start gap-3 text-xs leading-5 text-muted">
            <input className="mt-1" type="checkbox" />
            I understand this preview does not submit or store personal data
            until the approved privacy policy and quote service are connected.
          </label>
          <button
            className="mt-6 flex min-h-14 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-ink/15 px-5 text-sm font-black text-ink/45"
            disabled
            type="button"
          >
            Quote connection pending
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
