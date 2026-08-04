import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  notificationSettingsDocumentSchema,
  type NotificationSettingsDocument,
} from '@/lib/schemas/notification';

export type NotificationRuntimeSettings = Pick<
  NotificationSettingsDocument,
  'configurationVersion' | 'email' | 'sms'
>;

export function getDefaultNotificationSettings(): NotificationRuntimeSettings {
  return {
    configurationVersion: 'placeholder-notifications-v1',
    email: {
      enabled: false,
      fromName: 'BridgegateShop',
      fromEmail: 'orders@example.invalid',
      replyToEmail: null,
      maximumAttempts: 5,
    },
    sms: {
      enabled: false,
      senderId: 'Bridgegate',
      enabledStatuses: [
        'readyForPickup',
        'dispatched',
        'outForDelivery',
        'delivered',
      ],
      maximumAttempts: 3,
    },
  };
}

export async function loadNotificationSettings(
  firestore: Firestore = getFirebaseAdminFirestore(),
): Promise<NotificationRuntimeSettings> {
  const snapshot = await firestore
    .collection(firestoreCollections.commerceSettings)
    .doc('notifications')
    .get();
  if (!snapshot.exists) return getDefaultNotificationSettings();
  const parsed = notificationSettingsDocumentSchema.safeParse(snapshot.data());
  if (!parsed.success) {
    throw new Error('Stored notification settings are invalid.');
  }
  return {
    configurationVersion: parsed.data.configurationVersion,
    email: parsed.data.email,
    sms: parsed.data.sms,
  };
}
