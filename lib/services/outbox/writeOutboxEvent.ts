import 'server-only';

import type { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';

import { firestoreCollections } from '@/lib/firebase/collections';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

type OutboxPayloadValue = string | number | boolean | null;

export function writeOutboxEvent(
  transaction: Transaction,
  firestore: Firestore,
  input: {
    eventName: string;
    aggregateType: string;
    aggregateId: string;
    idempotencyKey: string;
    payload: Readonly<Record<string, OutboxPayloadValue>>;
    now: Timestamp;
  },
) {
  transaction.create(
    firestore.collection(firestoreCollections.outboxEvents).doc(
      createDeterministicId('outbox', input.idempotencyKey),
    ),
    {
      schemaVersion: 1,
      eventName: input.eventName,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      state: 'pending',
      attemptCount: 0,
      nextAttemptAt: input.now,
      leaseExpiresAt: null,
      createdAt: input.now,
    },
  );
}
