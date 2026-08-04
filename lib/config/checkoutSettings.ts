import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  getDefaultFulfilmentSettings,
  loadFulfilmentSettings,
  type BusinessCalendarSetting,
  type DeliveryZoneSetting,
} from '@/lib/config/fulfilmentSettings';
import type { CheckoutPaymentMethod } from '@/lib/schemas/checkout';
import {
  commercePaymentSettingsDocumentSchema,
  type CommercePaymentSettingsDocument,
} from '@/lib/schemas/commerceSettings';

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
  fulfilmentConfigurationVersion: string;
  pickup: ReturnType<typeof getDefaultFulfilmentSettings>['pickup'];
  deliveryZones: readonly DeliveryZoneSetting[];
  businessCalendar: readonly BusinessCalendarSetting[];
  supportWhatsappPhone: string | null;
  trackingRateLimit: ReturnType<
    typeof getDefaultFulfilmentSettings
  >['trackingRateLimit'];
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
  const fulfilment = getDefaultFulfilmentSettings();

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
    fulfilmentConfigurationVersion: fulfilment.configurationVersion,
    pickup: fulfilment.pickup,
    deliveryZones: fulfilment.deliveryZones,
    businessCalendar: fulfilment.businessCalendar,
    supportWhatsappPhone: fulfilment.supportWhatsappPhone,
    trackingRateLimit: fulfilment.trackingRateLimit,
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
  const [snapshot, fulfilment] = await Promise.all([
    firestore
      .collection(firestoreCollections.commerceSettings)
      .doc('payments')
      .get(),
    loadFulfilmentSettings(firestore),
  ]);
  const parsed = snapshot.exists
    ? commercePaymentSettingsDocumentSchema.safeParse(snapshot.data())
    : null;
  if (parsed && !parsed.success) {
    throw new Error('The stored commerce payment settings are invalid.');
  }

  const stored = parsed?.success ? parsed.data : null;
  return {
    ...fallback,
    fulfilmentConfigurationVersion: fulfilment.configurationVersion,
    pickup: fulfilment.pickup,
    deliveryZones: fulfilment.deliveryZones.map((zone) => ({
      ...zone,
      podEligible:
        zone.podEligible && Boolean(stored?.pod.allowedZoneIds.includes(zone.id)),
    })),
    businessCalendar: fulfilment.businessCalendar,
    supportWhatsappPhone: fulfilment.supportWhatsappPhone,
    trackingRateLimit: fulfilment.trackingRateLimit,
    configurationVersion: stored?.configurationVersion ?? fallback.configurationVersion,
    podReservationMinutes: stored?.pod.holdMinutes ?? fallback.podReservationMinutes,
    manualTransferReservationHours:
      stored?.manualTransfer.holdHours ?? fallback.manualTransferReservationHours,
    pod: stored?.pod ?? fallback.pod,
    manualTransfer: stored?.manualTransfer ?? fallback.manualTransfer,
    financialDocuments: stored?.financialDocuments ?? fallback.financialDocuments,
    paymentMethods: {
      ...fallback.paymentMethods,
      pod: {
        enabled: stored?.pod.enabled ?? false,
        customerLabel: 'Pay on Delivery',
        unavailableReason: stored?.pod.enabled
          ? null
          : fallback.paymentMethods.pod.unavailableReason,
      },
      manualTransfer: {
        enabled: stored?.manualTransfer.enabled ?? false,
        customerLabel: 'Manual Bank Transfer',
        unavailableReason: stored?.manualTransfer.enabled
          ? null
          : fallback.paymentMethods.manualTransfer.unavailableReason,
      },
    },
  };
}
