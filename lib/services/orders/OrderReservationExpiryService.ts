import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { productVariantDocumentSchema } from '@/lib/schemas/catalogue';
import {
  inventoryBalanceDocumentSchema,
  inventoryReservationDocumentSchema,
  type InventoryBalanceRecord,
} from '@/lib/schemas/inventory';
import { orderDocumentSchema, orderEventDocumentSchema } from '@/lib/schemas/order';
import {
  createInventoryService,
  InventoryMutationError,
  loadInventoryProjectionContexts,
  writeInventoryAvailabilityProjections,
} from '@/lib/services/inventory/InventoryService';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';
import { calculateStockState } from '@/lib/utils/inventory/calculateStockState';

function parseReservation(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = inventoryReservationDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new InventoryMutationError('INVALID_STATE', 'Reservation data is invalid.');
  }
  return { id: snapshot.id, ...parsed.data };
}

class FirestoreOrderReservationExpiryService {
  constructor(private readonly firestore: Firestore) {}

  async expireDueReservations(now = new Date(), limit = 100) {
    const dueSnapshot = await this.firestore
      .collection(firestoreCollections.inventoryReservations)
      .where('state', '==', 'active')
      .where('expiresAt', '<=', Timestamp.fromDate(now))
      .orderBy('expiresAt', 'asc')
      .limit(Math.max(1, Math.min(limit, 100)))
      .get();
    let expired = 0;

    for (const reservationSnapshot of dueSnapshot.docs) {
      const parsedReservation = inventoryReservationDocumentSchema.safeParse(
        reservationSnapshot.data(),
      );
      if (!parsedReservation.success) {
        throw new InventoryMutationError('INVALID_STATE', 'Reservation data is invalid.');
      }

      if (!parsedReservation.data.orderId) {
        const result = await createInventoryService(this.firestore).releaseReservation(
          {
            reservationId: reservationSnapshot.id,
            idempotencyKey: `expire:${reservationSnapshot.id}:v1`,
            reason: 'Reservation hold elapsed before order confirmation.',
          },
          {
            actorId: 'system:reservation-expiry',
            requestId: `expiry-${reservationSnapshot.id}`,
          },
          'expired',
        );
        if (!result.replay) expired += 1;
        continue;
      }

      const result = await this.expireOrderReservation(
        reservationSnapshot.id,
        parsedReservation.data.orderId,
      );
      if (!result.replay) expired += 1;
    }

    return { expired };
  }

  private async expireOrderReservation(reservationId: string, orderId: string) {
    const reservationReference = this.firestore
      .collection(firestoreCollections.inventoryReservations)
      .doc(reservationId);
    const orderReference = this.firestore
      .collection(firestoreCollections.orders)
      .doc(orderId);

    return this.firestore.runTransaction(async (transaction) => {
      const [reservationSnapshot, orderSnapshot] = await transaction.getAll(
        reservationReference,
        orderReference,
      );
      const reservation = parseReservation(reservationSnapshot);
      if (reservation.state === 'expired') return { replay: true };
      if (reservation.state !== 'active') {
        throw new InventoryMutationError('INVALID_STATE', 'A terminal reservation cannot expire again.');
      }

      const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
      if (!orderSnapshot.exists || !orderParse.success) {
        throw new InventoryMutationError('INVALID_STATE', 'Linked order data is invalid.');
      }
      const order = { id: orderSnapshot.id, ...orderParse.data };
      const variants = (
        await transaction.getAll(
          ...reservation.lines.map((line) =>
            this.firestore.collection(firestoreCollections.productVariants).doc(line.variantId),
          ),
        )
      ).map((snapshot) => {
        const parsed = productVariantDocumentSchema.safeParse(snapshot.data());
        if (!snapshot.exists || !parsed.success) {
          throw new InventoryMutationError('INVALID_STATE', 'Product variant data is invalid.');
        }
        return { id: snapshot.id, ...parsed.data };
      });
      const contexts = await loadInventoryProjectionContexts(
        transaction,
        this.firestore,
        variants.map((variant) => variant.productId),
      );
      const timestamp = Timestamp.now();
      const nextBalances = new Map<string, InventoryBalanceRecord>();

      for (const [index, variant] of variants.entries()) {
        if (!variant.stockManaged) continue;
        const line = reservation.lines[index];
        const currentBalance = contexts
          .get(variant.productId)
          ?.balancesByVariantId.get(variant.id);
        if (!currentBalance || currentBalance.reserved < line.quantity) {
          throw new InventoryMutationError(
            'INVALID_STATE',
            'Reservation balance reconciliation failed during expiry.',
          );
        }

        const nextReserved = currentBalance.reserved - line.quantity;
        const nextAvailable = currentBalance.onHand - nextReserved;
        const nextBalanceDocument = inventoryBalanceDocumentSchema.parse({
          ...currentBalance,
          reserved: nextReserved,
          available: nextAvailable,
          stockState: calculateStockState({
            stockManaged: true,
            available: nextAvailable,
            lowStockThreshold: currentBalance.lowStockThreshold,
          }),
          updatedAt: timestamp,
          updatedBy: 'system:reservation-expiry',
          version: currentBalance.version + 1,
        });
        nextBalances.set(variant.id, { id: variant.id, ...nextBalanceDocument });
      }

      const nextReservation = inventoryReservationDocumentSchema.parse({
        ...reservation,
        state: 'expired',
        committedAt: null,
        committedBy: null,
        releasedAt: timestamp,
        releasedBy: 'system:reservation-expiry',
        releaseReason: 'Payment was not verified before the checkout hold expired.',
        updatedAt: timestamp,
        updatedBy: 'system:reservation-expiry',
        version: reservation.version + 1,
      });
      const nextOrder = orderDocumentSchema.parse({
        ...order,
        orderStatus: 'failed',
        paymentStatus: 'failed',
        updatedAt: timestamp,
        updatedBy: 'system:reservation-expiry',
        version: order.version + 1,
      });

      transaction.set(reservationReference, nextReservation);
      transaction.set(orderReference, nextOrder);
      for (const nextBalance of nextBalances.values()) {
        transaction.set(
          this.firestore.collection(firestoreCollections.inventoryBalances).doc(nextBalance.id),
          inventoryBalanceDocumentSchema.parse(nextBalance),
        );
      }
      writeInventoryAvailabilityProjections(
        transaction,
        contexts,
        nextBalances,
        'system:reservation-expiry',
        timestamp,
      );
      transaction.create(
        orderReference
          .collection(firestoreCollections.orderEvents)
          .doc(createDeterministicId('event', `${reservationId}:expired`)),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId,
          eventType: 'payment.expired',
          previousOrderStatus: order.orderStatus,
          nextOrderStatus: 'failed',
          previousPaymentStatus: order.paymentStatus,
          nextPaymentStatus: 'failed',
          customerLabel: 'Payment window expired',
          customerNote: 'No verified payment was received before the stock hold ended.',
          actorId: 'system:reservation-expiry',
          idempotencyKey: `order-expired:${reservationId}`,
          occurredAt: timestamp,
        }),
      );
      transaction.create(
        this.firestore.collection(firestoreCollections.outboxEvents).doc(
          createDeterministicId('outbox', `${reservationId}:expired`),
        ),
        {
          schemaVersion: 1,
          eventName: 'order.paymentWindowExpired',
          aggregateType: 'order',
          aggregateId: orderId,
          payload: { orderReference: order.reference },
          state: 'pending',
          attemptCount: 0,
          nextAttemptAt: timestamp,
          leaseExpiresAt: null,
          createdAt: timestamp,
        },
      );

      return { replay: false };
    });
  }
}

export function createOrderReservationExpiryService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreOrderReservationExpiryService(firestore);
}

