import 'server-only';

import { type Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { deliveryDocumentSchema } from '@/lib/schemas/fulfilment';
import { createDeliveryExceptionService } from '@/lib/services/fulfilment/DeliveryExceptionService';

const activeFulfilmentStatuses = [
  'unfulfilled',
  'preparing',
  'readyForPickup',
  'dispatched',
  'outForDelivery',
] as const;

function localDateInLagos(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

class FirestoreDeliveryOverdueService {
  constructor(private readonly firestore: Firestore) {}

  async flagOverdueDeliveries(input?: { limit?: number; now?: Date }) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(input?.limit ?? 50)));
    const today = localDateInLagos(input?.now ?? new Date());
    const snapshots = await this.firestore
      .collection(firestoreCollections.deliveries)
      .where('status', 'in', activeFulfilmentStatuses)
      .where('estimate.latestDate', '<', today)
      .orderBy('estimate.latestDate', 'asc')
      .limit(safeLimit)
      .get();
    const exceptionService = createDeliveryExceptionService(this.firestore);
    const summary = { inspected: snapshots.size, flagged: 0, replayed: 0, invalid: 0 };

    for (const snapshot of snapshots.docs) {
      const parsed = deliveryDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) {
        summary.invalid += 1;
        continue;
      }
      if (parsed.data.exceptionFlags.includes('overdueEstimate')) {
        summary.replayed += 1;
        continue;
      }
      const result = await exceptionService.report(
        {
          deliveryId: snapshot.id,
          type: 'overdueEstimate',
          reason: `The promised fulfilment window ended on ${parsed.data.estimate.latestDate}.`,
          sourceEventId: null,
          expectedDeliveryVersion: null,
          idempotencyKey: `overdue-estimate:${snapshot.id}:${parsed.data.estimate.latestDate}`,
        },
        {
          actorId: 'system:delivery-overdue',
          roleIds: [],
          requestId: `delivery-overdue:${today}:${snapshot.id}`,
        },
      );
      if (result.replay) summary.replayed += 1;
      else summary.flagged += 1;
    }

    return { ...summary, localDate: today };
  }
}

export function createDeliveryOverdueService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreDeliveryOverdueService(firestore);
}

