import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { inventoryReservationDocumentSchema } from '@/lib/schemas/inventory';
import { orderDocumentSchema, orderEventDocumentSchema } from '@/lib/schemas/order';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { releaseCheckoutInventoryInTransaction } from '@/lib/services/inventory/releaseCheckoutInventoryInTransaction';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

const cancelOrderInputSchema = z.object({
  orderId: z.string().min(1).max(128),
  reason: z.string().trim().min(3).max(500),
  expectedOrderVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export class OrderCancellationError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'OrderCancellationError';
  }
}

type CancellationActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

class FirestoreOrderCancellationService {
  constructor(private readonly firestore: Firestore) {}

  async cancelOrder(
    unparsedInput: z.input<typeof cancelOrderInputSchema>,
    actor: CancellationActor,
  ) {
    const input = cancelOrderInputSchema.parse(unparsedInput);
    const orderReference = this.firestore
      .collection(firestoreCollections.orders)
      .doc(input.orderId);
    const eventReference = orderReference
      .collection(firestoreCollections.orderEvents)
      .doc(createDeterministicId('event', `cancel:${input.orderId}:${input.idempotencyKey}`));

    return this.firestore.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderReference);
      const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
      if (!orderSnapshot.exists || !orderParse.success) {
        throw new OrderCancellationError('NOT_FOUND', 'Order was not found.');
      }
      const order = { id: orderSnapshot.id, ...orderParse.data };
      const reservationReference = this.firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(order.reservationId);
      const [reservationSnapshot, eventSnapshot] = await transaction.getAll(
        reservationReference,
        eventReference,
      );
      if (eventSnapshot.exists) return { order, replay: true };
      if (order.version !== input.expectedOrderVersion) {
        throw new OrderCancellationError('CONFLICT', 'The order changed before cancellation.');
      }
      if (order.orderStatus === 'cancelled' || order.orderStatus === 'completed') {
        throw new OrderCancellationError('INVALID_STATE', 'This order cannot be cancelled again.');
      }
      if (['readyForPickup', 'dispatched', 'outForDelivery', 'delivered', 'collected'].includes(order.fulfilmentStatus)) {
        throw new OrderCancellationError('INVALID_STATE', 'This order must follow the approved returns workflow.');
      }
      if (order.totals.amountPaidKobo > order.refundTotalKobo) {
        throw new OrderCancellationError('INVALID_STATE', 'Paid value must be refunded before cancellation.');
      }
      const reservationParse = inventoryReservationDocumentSchema.safeParse(reservationSnapshot.data());
      if (!reservationSnapshot.exists || !reservationParse.success) {
        throw new OrderCancellationError('INVALID_STATE', 'Order reservation data is invalid.');
      }
      const now = Timestamp.now();
      if (reservationParse.data.state === 'active') {
        await releaseCheckoutInventoryInTransaction({
          transaction,
          firestore: this.firestore,
          reservationId: order.reservationId,
          terminalState: 'released',
          reason: input.reason,
          actorId: actor.actorId,
          now,
        });
      } else if (reservationParse.data.state !== 'committed') {
        throw new OrderCancellationError('INVALID_STATE', 'The order reservation is already terminal.');
      }
      const nextOrderDocument = orderDocumentSchema.parse({
        ...order,
        orderStatus: 'cancelled',
        fulfilmentStatus: 'cancelled',
        cancellationSummary: {
          reason: input.reason,
          actorId: actor.actorId,
          cancelledAt: now,
          idempotencyKey: input.idempotencyKey,
        },
        cancelledAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: order.version + 1,
      });
      transaction.set(orderReference, nextOrderDocument);
      transaction.create(eventReference, orderEventDocumentSchema.parse({
        schemaVersion: 1,
        orderId: order.id,
        eventType: 'order.cancelled',
        previousOrderStatus: order.orderStatus,
        nextOrderStatus: 'cancelled',
        previousPaymentStatus: order.paymentStatus,
        nextPaymentStatus: nextOrderDocument.paymentStatus,
        customerLabel: 'Order cancelled',
        customerNote: 'The order was cancelled through an authorised review.',
        actorId: actor.actorId,
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
      }));
      transaction.create(
        this.firestore.collection(firestoreCollections.outboxEvents).doc(
          createDeterministicId('outbox', `order-cancelled:${order.id}:${input.idempotencyKey}`),
        ),
        {
          schemaVersion: 1,
          eventName: 'order.cancelled',
          aggregateType: 'order',
          aggregateId: order.id,
          payload: { orderReference: order.reference },
          state: 'pending',
          attemptCount: 0,
          nextAttemptAt: now,
          leaseExpiresAt: null,
          createdAt: now,
        },
      );
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'order.cancel',
        entityType: 'order',
        entityId: order.id,
        publicReference: order.reference,
        requestId: actor.requestId,
        changedFields: ['orderStatus', 'fulfilmentStatus', 'cancelledAt'],
        reason: input.reason,
      });
      return { order: { id: order.id, ...nextOrderDocument }, replay: false };
    });
  }
}

export function createOrderCancellationService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreOrderCancellationService(firestore);
}
