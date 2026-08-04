import type { Metadata } from 'next';

import { TrackingLookupForm } from '@/app/track-order/TrackingLookupForm';

export const metadata: Metadata = {
  title: 'Track an order',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function TrackOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  const defaultReference =
    typeof reference === 'string' ? reference.slice(0, 32) : '';

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
        <TrackingLookupForm defaultReference={defaultReference} />
      </div>
    </div>
  );
}
