import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { loadNotificationSettings } from '@/lib/config/notificationSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import {
  fulfilmentOutboxPayloadSchema,
  outboxEventDocumentSchema,
} from '@/lib/schemas/outbox';
import { createDeliveryExceptionService } from '@/lib/services/fulfilment/DeliveryExceptionService';
import { createNotificationProviders } from '@/lib/services/notifications/createNotificationProviders';
import {
  createNotificationService,
  type NotificationDeliveryResult,
} from '@/lib/services/notifications/NotificationService';

const maximumWorkerAttempts = 5;
const leaseDurationMilliseconds = 2 * 60_000;

type NotificationProcessor = {
  processDeliveryEvent(
    deliveryId: string,
    deliveryEventId: string,
  ): Promise<NotificationDeliveryResult[]>;
};

function retryTimestamp(now: Timestamp, attemptCount: number) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attemptCount - 1));
  return Timestamp.fromMillis(now.toMillis() + delayMinutes * 60_000);
}

function safeWorkerFailure(error: unknown) {
  if (error instanceof Error && error.message.length <= 200) {
    return error.message;
  }
  return 'Fulfilment notification processing failed.';
}

class FirestoreFulfilmentOutboxWorker {
  constructor(
    private readonly firestore: Firestore,
    private readonly notificationProcessorFactory: () => Promise<NotificationProcessor>,
  ) {}

  async processDueEvents(limit = 25) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const now = Timestamp.now();
    const snapshots = await this.firestore
      .collection(firestoreCollections.outboxEvents)
      .where('eventName', '==', 'fulfilment.updated')
      .where('state', 'in', ['pending', 'processing'])
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt', 'asc')
      .limit(safeLimit)
      .get();
    const processor = await this.notificationProcessorFactory();
    const summary = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };

    for (const snapshot of snapshots.docs) {
      const reference = snapshot.ref;
      const claim = await this.firestore.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(reference);
        const currentParse = outboxEventDocumentSchema.safeParse(
          currentSnapshot.data(),
        );
        if (!currentSnapshot.exists || !currentParse.success) return null;
        const current = currentParse.data;
        const currentTime = Timestamp.now();
        if (
          current.eventName !== 'fulfilment.updated' ||
          !['pending', 'processing'].includes(current.state) ||
          firestoreTimestampToDate(current.nextAttemptAt).getTime() > currentTime.toMillis() ||
          (current.state === 'processing' &&
            current.leaseExpiresAt &&
            firestoreTimestampToDate(current.leaseExpiresAt).getTime() > currentTime.toMillis())
        ) {
          return null;
        }
        const payloadParse = fulfilmentOutboxPayloadSchema.safeParse(
          current.payload,
        );
        if (!payloadParse.success || current.attemptCount >= maximumWorkerAttempts) {
          transaction.update(reference, {
            state: 'deadLetter',
            leaseExpiresAt: null,
            lastSafeError: payloadParse.success
              ? 'Maximum outbox attempts reached.'
              : 'Fulfilment outbox payload is invalid.',
          });
          return { deadLetter: true as const, event: current, payload: null };
        }
        const attemptCount = current.attemptCount + 1;
        transaction.update(reference, {
          state: 'processing',
          attemptCount,
          leaseExpiresAt: Timestamp.fromMillis(
            currentTime.toMillis() + leaseDurationMilliseconds,
          ),
          lastSafeError: null,
        });
        return {
          deadLetter: false as const,
          event: { ...current, attemptCount },
          payload: payloadParse.data,
        };
      });
      if (!claim) continue;
      summary.claimed += 1;
      if (claim.deadLetter || !claim.payload) {
        summary.deadLettered += 1;
        continue;
      }

      try {
        const results = await processor.processDeliveryEvent(
          claim.event.aggregateId,
          claim.payload.deliveryEventId,
        );
        const failures = results.filter((result) => result.state === 'failed');
        if (failures.length === 0) {
          await reference.update({
            state: 'processed',
            leaseExpiresAt: null,
            lastSafeError: null,
            processedAt: Timestamp.now(),
          });
          summary.processed += 1;
          continue;
        }
        const terminal =
          failures.every((failure) => failure.terminal) ||
          claim.event.attemptCount >= maximumWorkerAttempts;
        await reference.update({
          state: terminal ? 'deadLetter' : 'pending',
          leaseExpiresAt: null,
          nextAttemptAt: retryTimestamp(Timestamp.now(), claim.event.attemptCount),
          lastSafeError: terminal
            ? 'Notification delivery exhausted its retry policy.'
            : 'Notification delivery will be retried.',
        });
        if (terminal) {
          summary.deadLettered += 1;
          await this.reportNotificationException(
            claim.event.aggregateId,
            claim.payload.deliveryEventId,
            reference.id,
          );
        } else {
          summary.retried += 1;
        }
      } catch (error) {
        const terminal = claim.event.attemptCount >= maximumWorkerAttempts;
        await reference.update({
          state: terminal ? 'deadLetter' : 'pending',
          leaseExpiresAt: null,
          nextAttemptAt: retryTimestamp(Timestamp.now(), claim.event.attemptCount),
          lastSafeError: safeWorkerFailure(error),
        });
        if (terminal) {
          summary.deadLettered += 1;
          await this.reportNotificationException(
            claim.event.aggregateId,
            claim.payload.deliveryEventId,
            reference.id,
          );
        } else {
          summary.retried += 1;
        }
      }
    }
    return summary;
  }

  private async reportNotificationException(
    deliveryId: string,
    deliveryEventId: string,
    outboxEventId: string,
  ) {
    await createDeliveryExceptionService(this.firestore).report(
      {
        deliveryId,
        type: 'notificationFailed',
        reason: 'A customer fulfilment notification exhausted its retry policy.',
        sourceEventId: deliveryEventId,
        expectedDeliveryVersion: null,
        idempotencyKey: `notification-failed:${outboxEventId}`,
      },
      {
        actorId: 'system:outbox',
        roleIds: [],
        requestId: `outbox:${outboxEventId}`,
      },
    );
  }
}

export function createFulfilmentOutboxWorker(input?: {
  firestore?: Firestore;
  notificationProcessorFactory?: () => Promise<NotificationProcessor>;
}) {
  const firestore = input?.firestore ?? getFirebaseAdminFirestore();
  const notificationProcessorFactory =
    input?.notificationProcessorFactory ??
    (async () => {
      const settings = await loadNotificationSettings(firestore);
      return createNotificationService({
        firestore,
        settings,
        providers: createNotificationProviders(),
        baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
      });
    });
  return new FirestoreFulfilmentOutboxWorker(
    firestore,
    notificationProcessorFactory,
  );
}

