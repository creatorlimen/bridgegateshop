import type { Metadata } from 'next';

import { PolicyPlaceholder } from '@/app/components/content/PolicyPlaceholder';

export const metadata: Metadata = {
  title: 'Returns and refunds',
};

export default function ReturnsRefundsPage() {
  return (
    <PolicyPlaceholder
      eyebrow="Returns & refunds"
      title="A controlled process for cancellations, returns, and refunds."
      summary="The application will preserve original payment records, separate refund state from stock restoration, and require authorised decisions."
      sections={[
        {
          title: 'Order cancellation',
          description:
            'Final copy must define when unpaid, paid, prepared, dispatched, delivered, and collected orders may be cancelled or moved into a returns process.',
        },
        {
          title: 'Returns and damaged items',
          description:
            'Final copy must define reporting windows, evidence, product condition, inspection, collection, and accepted-return rules.',
        },
        {
          title: 'Refund handling',
          description:
            'Refund states, timing, partial amounts, provider processing, and customer communication require approved business and legal language.',
        },
      ]}
    />
  );
}
