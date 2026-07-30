import type { Metadata } from 'next';

import { PolicyPlaceholder } from '@/app/components/content/PolicyPlaceholder';

export const metadata: Metadata = {
  title: 'Terms and conditions',
};

export default function TermsPage() {
  return (
    <PolicyPlaceholder
      eyebrow="Terms"
      title="The commercial rules behind every accepted order."
      summary="Engineering will capture the exact published version accepted at checkout. Specta’s adviser must provide the binding terms."
      sections={[
        {
          title: 'Products, prices, and orders',
          description:
            'Define catalogue accuracy, availability, server-validated pricing, acceptance, quantity limits, order references, and error correction.',
        },
        {
          title: 'Payment and fulfilment',
          description:
            'Define Paystack, Pay on Delivery, Manual Bank Transfer, credit where enabled, delivery, pickup, outstanding balances, and delays.',
        },
        {
          title: 'Use, liability, and support',
          description:
            'Define acceptable use, calculator limitations, contractor-directory disclaimers, customer responsibilities, support, and dispute routes.',
        },
      ]}
    />
  );
}
