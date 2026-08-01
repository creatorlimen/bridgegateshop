import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import type { CheckoutPaymentMethod } from '@/lib/schemas/checkout';
import {
  commercePaymentSettingsDocumentSchema,
  type CommercePaymentSettingsDocument,
} from '@/lib/schemas/commerceSettings';

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
  configurationVersion: string;
  pod: CommercePaymentSettingsDocument['pod'];
  manualTransfer: CommercePaymentSettingsDocument['manualTransfer'];
  financialDocuments: CommercePaymentSettingsDocument['financialDocuments'];
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
    estimateLabel: 'Estimated delivery in 1-2 business days.',
    podEligible: false,
  },
  {
    id: 'lagos-mainland',
    name: 'Lagos Mainland',
    feeKobo: 350_000,
    estimateLabel: 'Estimated delivery in 1-2 business days.',
    podEligible: false,
  },
  {
    id: 'lagos-outskirts',
    name: 'Outskirts / Satellite Towns',
    feeKobo: 700_000,
    estimateLabel: 'Estimated delivery in 2-4 business days.',
    podEligible: false,
  },
];

const defaultPaymentSettings = {
  configurationVersion: 'placeholder-v1',
  pod: {
    enabled: false,
    allowedZoneIds: [],
    excludedProductIds: [],
    excludedVariantIds: [],
    restrictedOwnerUids: [],
    restrictedEmails: [],
    minimumOrderKobo: 0,
    maximumOrderKobo: 50_000_000,
    depositThresholdKobo: 5_000_000,
    depositBasisPoints: 3_000,
    confirmationMode: 'staffApproval' as const,
    holdMinutes: 60,
  },
  manualTransfer: {
    enabled: false,
    holdHours: 24,
    allowPartialPayments: false,
    evidenceUploadEnabled: false,
    evidenceRetentionDays: 365,
    instructionsVersion: 'placeholder-v1',
    instructions: {
      bankName: 'Approved bank pending',
      accountName: 'Specta Industries Limited',
      accountNumber: '0000000000',
      customerMessage: 'Use the order reference as the transfer narration.',
    },
  },
  financialDocuments: {
    businessName: 'Specta Industries Limited',
    businessAddress: 'Approved business address pending final content.',
    businessEmail: 'orders@example.invalid',
    businessPhone: '+2340000000000',
    registrationNumber: null,
    taxNumber: null,
  },
};

export function getCheckoutSettings(): CheckoutSettings {
  const paystackEnabled = Boolean(process.env.PAYSTACK_SECRET_KEY);

  return {
    currency: 'NGN',
    paystackReservationMinutes: 15,
    manualTransferReservationHours: defaultPaymentSettings.manualTransfer.holdHours,
    podReservationMinutes: defaultPaymentSettings.pod.holdMinutes,
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
    ...defaultPaymentSettings,
    paymentMethods: {
      paystack: {
        enabled: paystackEnabled,
        customerLabel: 'Pay online with Paystack',
        unavailableReason: paystackEnabled
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

export async function loadCheckoutSettings(
  firestore: Firestore = getFirebaseAdminFirestore(),
): Promise<CheckoutSettings> {
  const fallback = getCheckoutSettings();
  const snapshot = await firestore
    .collection(firestoreCollections.commerceSettings)
    .doc('payments')
    .get();

  if (!snapshot.exists) return fallback;

  const parsed = commercePaymentSettingsDocumentSchema.safeParse(snapshot.data());
  if (!parsed.success) {
    throw new Error('The stored commerce payment settings are invalid.');
  }

  const stored = parsed.data;
  return {
    ...fallback,
    configurationVersion: stored.configurationVersion,
    podReservationMinutes: stored.pod.holdMinutes,
    manualTransferReservationHours: stored.manualTransfer.holdHours,
    pod: stored.pod,
    manualTransfer: stored.manualTransfer,
    financialDocuments: stored.financialDocuments,
    deliveryZones: fallback.deliveryZones.map((zone) => ({
      ...zone,
      podEligible: stored.pod.allowedZoneIds.includes(zone.id),
    })),
    paymentMethods: {
      ...fallback.paymentMethods,
      pod: {
        enabled: stored.pod.enabled,
        customerLabel: 'Pay on Delivery',
        unavailableReason: stored.pod.enabled
          ? null
          : fallback.paymentMethods.pod.unavailableReason,
      },
      manualTransfer: {
        enabled: stored.manualTransfer.enabled,
        customerLabel: 'Manual Bank Transfer',
        unavailableReason: stored.manualTransfer.enabled
          ? null
          : fallback.paymentMethods.manualTransfer.unavailableReason,
      },
    },
  };
}
