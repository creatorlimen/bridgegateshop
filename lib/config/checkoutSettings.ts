import 'server-only';

import type { CheckoutPaymentMethod } from '@/lib/schemas/checkout';

export type DeliveryZoneSetting = {
  id: string;
  name: string;
  feeKobo: number;
  estimateLabel: string;
  podEligible: boolean;
};

export type CheckoutSettings = {
  currency: 'NGN';
  paystackReservationMinutes: number;
  manualTransferReservationHours: number;
  podReservationMinutes: number;
  policyEvidence: {
    termsPolicyId: string;
    termsVersion: string;
    privacyPolicyId: string;
    privacyVersion: string;
  };
  pickup: {
    label: string;
    address: string;
    openingHours: string;
  };
  deliveryZones: readonly DeliveryZoneSetting[];
  paymentMethods: Readonly<
    Record<
      CheckoutPaymentMethod,
      { enabled: boolean; customerLabel: string; unavailableReason: string | null }
    >
  >;
};

const deliveryZones: readonly DeliveryZoneSetting[] = [
  {
    id: 'lagos-island',
    name: 'Lagos Island',
    feeKobo: 500_000,
    estimateLabel: 'Estimated delivery in 1–2 business days.',
    podEligible: false,
  },
  {
    id: 'lagos-mainland',
    name: 'Lagos Mainland',
    feeKobo: 350_000,
    estimateLabel: 'Estimated delivery in 1–2 business days.',
    podEligible: false,
  },
  {
    id: 'lagos-outskirts',
    name: 'Outskirts / Satellite Towns',
    feeKobo: 700_000,
    estimateLabel: 'Estimated delivery in 2–4 business days.',
    podEligible: false,
  },
];

export function getCheckoutSettings(): CheckoutSettings {
  return {
    currency: 'NGN',
    paystackReservationMinutes: 15,
    manualTransferReservationHours: 24,
    podReservationMinutes: 60,
    policyEvidence: {
      termsPolicyId: 'bridgegate-terms',
      termsVersion: 'placeholder-v1',
      privacyPolicyId: 'bridgegate-privacy',
      privacyVersion: 'placeholder-v1',
    },
    pickup: {
      label: 'Specta store pickup',
      address: 'Approved Specta pickup address pending final content.',
      openingHours: 'Approved opening hours pending final content.',
    },
    deliveryZones,
    paymentMethods: {
      paystack: {
        enabled: Boolean(process.env.PAYSTACK_SECRET_KEY),
        customerLabel: 'Pay online with Paystack',
        unavailableReason: process.env.PAYSTACK_SECRET_KEY
          ? null
          : 'Paystack is unavailable until the server key is configured.',
      },
      pod: {
        enabled: false,
        customerLabel: 'Pay on Delivery',
        unavailableReason:
          'Pay on Delivery remains disabled until eligibility and confirmation rules are approved.',
      },
      manualTransfer: {
        enabled: false,
        customerLabel: 'Manual Bank Transfer',
        unavailableReason:
          'Bank transfer remains disabled until protected bank instructions are approved.',
      },
    },
  };
}

