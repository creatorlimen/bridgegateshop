import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  businessCalendarDocumentSchema,
  deliveryZoneDocumentSchema,
  fulfilmentSettingsDocumentSchema,
  type BusinessCalendarDocument,
  type DeliveryZoneDocument,
  type FulfilmentSettingsDocument,
} from '@/lib/schemas/fulfilment';

export type DeliveryZoneSetting = Pick<
  DeliveryZoneDocument,
  | 'name'
  | 'active'
  | 'areaHints'
  | 'postcodeHints'
  | 'feeKobo'
  | 'serviceDays'
  | 'sameDayEnabled'
  | 'cutoffLocalTime'
  | 'minimumBusinessDays'
  | 'maximumBusinessDays'
  | 'podEligible'
  | 'deliveryEnabled'
  | 'displayCopy'
  | 'priority'
> & {
  id: string;
  estimateLabel: string;
};

export type BusinessCalendarSetting = Pick<
  BusinessCalendarDocument,
  'date' | 'name' | 'open' | 'affectedZoneIds' | 'note'
> & { id: string };

export type FulfilmentRuntimeSettings = {
  configurationVersion: string;
  pickup: FulfilmentSettingsDocument['pickup'];
  supportWhatsappPhone: string | null;
  trackingRateLimit: FulfilmentSettingsDocument['trackingRateLimit'];
  deliveryZones: readonly DeliveryZoneSetting[];
  businessCalendar: readonly BusinessCalendarSetting[];
};

const defaultZones: readonly DeliveryZoneSetting[] = [
  {
    id: 'lagos-island',
    name: 'Lagos Island',
    active: true,
    areaHints: [],
    postcodeHints: [],
    feeKobo: 500_000,
    serviceDays: [1, 2, 3, 4, 5, 6],
    sameDayEnabled: false,
    cutoffLocalTime: '12:00',
    minimumBusinessDays: 1,
    maximumBusinessDays: 2,
    podEligible: false,
    deliveryEnabled: true,
    displayCopy: 'Approved areas and service rules are pending final operational sign-off.',
    priority: 10,
    estimateLabel: 'Estimated delivery in 1–2 business days.',
  },
  {
    id: 'lagos-mainland',
    name: 'Lagos Mainland',
    active: true,
    areaHints: [],
    postcodeHints: [],
    feeKobo: 350_000,
    serviceDays: [1, 2, 3, 4, 5, 6],
    sameDayEnabled: false,
    cutoffLocalTime: '12:00',
    minimumBusinessDays: 1,
    maximumBusinessDays: 2,
    podEligible: false,
    deliveryEnabled: true,
    displayCopy: 'Approved areas and service rules are pending final operational sign-off.',
    priority: 20,
    estimateLabel: 'Estimated delivery in 1–2 business days.',
  },
  {
    id: 'lagos-outskirts',
    name: 'Outskirts / Satellite Towns',
    active: true,
    areaHints: [],
    postcodeHints: [],
    feeKobo: 700_000,
    serviceDays: [1, 2, 3, 4, 5, 6],
    sameDayEnabled: false,
    cutoffLocalTime: '12:00',
    minimumBusinessDays: 2,
    maximumBusinessDays: 4,
    podEligible: false,
    deliveryEnabled: true,
    displayCopy: 'Supported areas and final service windows are pending operational sign-off.',
    priority: 30,
    estimateLabel: 'Estimated delivery in 2–4 business days.',
  },
];

export function getDefaultFulfilmentSettings(): FulfilmentRuntimeSettings {
  return {
    configurationVersion: 'placeholder-fulfilment-v1',
    pickup: {
      enabled: true,
      label: 'Specta store pickup',
      address: 'Approved Specta pickup address pending final content.',
      openingHours: 'Approved opening hours pending final content.',
      serviceDays: [1, 2, 3, 4, 5, 6],
      cutoffLocalTime: '12:00',
      sameDayEnabled: false,
      minimumPreparationBusinessDays: 1,
      maximumPreparationBusinessDays: 2,
    },
    supportWhatsappPhone: null,
    trackingRateLimit: {
      windowMinutes: 15,
      maximumAttemptsPerIp: 10,
      maximumAttemptsPerReference: 5,
      maximumAttemptsPerFactor: 5,
    },
    deliveryZones: defaultZones,
    businessCalendar: [],
  };
}

function estimateLabel(zone: DeliveryZoneDocument) {
  return zone.minimumBusinessDays === zone.maximumBusinessDays
    ? `Estimated delivery in ${zone.minimumBusinessDays} business day${zone.minimumBusinessDays === 1 ? '' : 's'}.`
    : `Estimated delivery in ${zone.minimumBusinessDays}–${zone.maximumBusinessDays} business days.`;
}

export async function loadFulfilmentSettings(
  firestore: Firestore = getFirebaseAdminFirestore(),
): Promise<FulfilmentRuntimeSettings> {
  const fallback = getDefaultFulfilmentSettings();
  const [settingsSnapshot, zoneSnapshot, calendarSnapshot] = await Promise.all([
    firestore.collection(firestoreCollections.commerceSettings).doc('fulfilment').get(),
    firestore.collection(firestoreCollections.deliveryZones).orderBy('priority', 'asc').limit(100).get(),
    firestore.collection(firestoreCollections.businessCalendar).orderBy('date', 'asc').limit(400).get(),
  ]);
  const settings = settingsSnapshot.exists
    ? fulfilmentSettingsDocumentSchema.safeParse(settingsSnapshot.data())
    : null;
  if (settings && !settings.success) {
    throw new Error('The stored fulfilment settings are invalid.');
  }
  const zones = zoneSnapshot.docs.map((snapshot) => {
    const parsed = deliveryZoneDocumentSchema.safeParse(snapshot.data());
    if (!parsed.success) throw new Error('Stored delivery-zone data is invalid.');
    return { id: snapshot.id, ...parsed.data, estimateLabel: estimateLabel(parsed.data) };
  });
  const businessCalendar = calendarSnapshot.docs.map((snapshot) => {
    const parsed = businessCalendarDocumentSchema.safeParse(snapshot.data());
    if (!parsed.success) throw new Error('Stored business-calendar data is invalid.');
    return { id: snapshot.id, ...parsed.data };
  });
  const stored = settings?.success ? settings.data : null;

  return {
    configurationVersion: stored?.configurationVersion ?? fallback.configurationVersion,
    pickup: stored?.pickup ?? fallback.pickup,
    supportWhatsappPhone: stored?.supportWhatsappPhone ?? fallback.supportWhatsappPhone,
    trackingRateLimit: stored?.trackingRateLimit ?? fallback.trackingRateLimit,
    deliveryZones: zones.length > 0 ? zones : fallback.deliveryZones,
    businessCalendar,
  };
}
