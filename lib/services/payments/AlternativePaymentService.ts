import 'server-only';

import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { Role } from '@/lib/auth/roles';
import {
  getCheckoutSettings,
  type CheckoutSettings,
} from '@/lib/config/checkoutSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { inventoryReservationDocumentSchema } from '@/lib/schemas/inventory';
import {
  manualPaymentInputSchema,
  transferEvidenceDocumentSchema,
  type ManualPaymentInput,
} from '@/lib/schemas/manualPayment';
import {
  orderDocumentSchema,
  orderEventDocumentSchema,
  orderItemDocumentSchema,
} from '@/lib/schemas/order';
import { paymentDocumentSchema } from '@/lib/schemas/payment';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { commitCheckoutInventoryInTransaction } from '@/lib/services/inventory/inventoryTransactionOperations';
import { writeOutboxEvent } from '@/lib/services/outbox/writeOutboxEvent';
import { writeFinancialDocumentInTransaction } from '@/lib/services/payments/FinancialDocumentService';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

export type FinancialStaffActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

export class AlternativePaymentError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'AlternativePaymentError';
  }
}

function parseOrder(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = orderDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new AlternativePaymentError(snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND', 'Order data is invalid.');
  }
  return { id: snapshot.id, ...parsed.data };
}

function parseReservation(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = inventoryReservationDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new AlternativePaymentError('INVALID_STATE', 'Order reservation data is invalid.');
  }
  return parsed.data;
}

const approvePodInputSchema = z.object({
  orderId: z.string().min(1).max(128),
  expectedOrderVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

class FirestoreAlternativePaymentService {
  constructor(
    private readonly firestore: Firestore,
    private readonly settings: CheckoutSettings,
  ) {}

  async approvePodOrder(unparsedInput: z.input<typeof approvePodInputSchema>, actor: FinancialStaffActor) {
    const input = approvePodInputSchema.parse(unparsedInput);
    const orderReference = this.firestore.collection(firestoreCollections.orders).doc(input.orderId);
    const eventReference = orderReference
      .collection(firestoreCollections.orderEvents)
      .doc(createDeterministicId('event', `pod-approval:${input.orderId}:${input.idempotencyKey}`));

    return this.firestore.runTransaction(async (transaction) => {
      const order = parseOrder(await transaction.get(orderReference));
      const reservationReference = this.firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(order.reservationId);
      const [reservationSnapshot, eventSnapshot, itemSnapshot] = await Promise.all([
        transaction.get(reservationReference),
        transaction.get(eventReference),
        transaction.get(orderReference.collection(firestoreCollections.orderItems)),
      ]);
      if (eventSnapshot.exists) return { order, replay: true };
      const reservation = parseReservation(reservationSnapshot);
      if (
        order.version !== input.expectedOrderVersion ||
        order.paymentSelection.method !== 'pod' ||
        order.paymentSelection.depositKobo !== 0 ||
        order.orderStatus !== 'pending' ||
        order.paymentStatus !== 'unpaid' ||
        reservation.state !== 'active'
      ) {
        throw new AlternativePaymentError('INVALID_STATE', 'This POD order is not eligible for approval.');
      }
      const items = itemSnapshot.docs.map((snapshot) => {
        const parsed = orderItemDocumentSchema.safeParse(snapshot.data());
        if (!parsed.success) throw new AlternativePaymentError('INVALID_STATE', 'Order item data is invalid.');
        return parsed.data;
      });
      const now = Timestamp.now();
      await commitCheckoutInventoryInTransaction({
        transaction,
        firestore: this.firestore,
        reservationId: order.reservationId,
        idempotencyKey: `pod-approval:${input.idempotencyKey}`,
        reason: `POD order ${order.reference} approved by authorised staff.`,
        actor: { actorId: actor.actorId, requestId: actor.requestId },
        now,
      });
      const nextOrderDocument = orderDocumentSchema.parse({
        ...order,
        orderStatus: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: order.version + 1,
      });
      const nextOrder = { id: order.id, ...nextOrderDocument };
      transaction.set(orderReference, nextOrderDocument);
      transaction.create(eventReference, orderEventDocumentSchema.parse({
        schemaVersion: 1,
        orderId: order.id,
        eventType: 'pod.approved',
        previousOrderStatus: order.orderStatus,
        nextOrderStatus: 'confirmed',
        previousPaymentStatus: order.paymentStatus,
        nextPaymentStatus: order.paymentStatus,
        customerLabel: 'Pay on Delivery approved',
        customerNote: 'Your order was accepted. Payment remains due on delivery.',
        actorId: actor.actorId,
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
      }));
      writeFinancialDocumentInTransaction({
        transaction,
        firestore: this.firestore,
        order: nextOrder,
        items,
        settings: this.settings,
        documentType: 'invoice',
        amountKobo: nextOrder.totals.grandTotalKobo,
        paymentId: null,
        refundId: null,
        actorId: actor.actorId,
        now,
      });
      writeOutboxEvent(transaction, this.firestore, {
        eventName: 'order.podApproved',
        aggregateType: 'order',
        aggregateId: order.id,
        idempotencyKey: `pod-approved:${order.id}:${input.idempotencyKey}`,
        payload: {
          orderReference: order.reference,
          amountOutstandingKobo: nextOrder.totals.amountOutstandingKobo,
        },
        now,
      });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'order.pod.approve',
        entityType: 'order',
        entityId: order.id,
        publicReference: order.reference,
        requestId: actor.requestId,
        changedFields: ['orderStatus', 'confirmedAt'],
      });
      return { order: nextOrder, replay: false };
    });
  }

  recordManualTransfer(input: ManualPaymentInput, actor: FinancialStaffActor) {
    return this.recordOfflinePayment('manualTransfer', input, actor);
  }

  recordPodCollection(input: ManualPaymentInput, actor: FinancialStaffActor) {
    return this.recordOfflinePayment('pod', input, actor);
  }

  private async recordOfflinePayment(
    method: 'manualTransfer' | 'pod',
    unparsedInput: ManualPaymentInput,
    actor: FinancialStaffActor,
  ) {
    const input = manualPaymentInputSchema.parse(unparsedInput);
    const referenceHash = createHash('sha256')
      .update(`${method}:${input.externalReference}`)
      .digest('hex');
    const providerReference = `manual-${referenceHash.slice(0, 40)}`;
    const paymentId = createDeterministicId('payment', providerReference);
    const claimId = createDeterministicId('claim', providerReference);
    const orderReference = this.firestore.collection(firestoreCollections.orders).doc(input.orderId);
    const paymentReference = this.firestore.collection(firestoreCollections.payments).doc(paymentId);
    const claimReference = this.firestore.collection(firestoreCollections.paymentReferenceClaims).doc(claimId);

    return this.firestore.runTransaction(async (transaction) => {
      const order = parseOrder(await transaction.get(orderReference));
      const reservationReference = this.firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(order.reservationId);
      const reads: FirebaseFirestore.DocumentReference[] = [
        reservationReference,
        paymentReference,
        claimReference,
      ];
      if (input.evidenceId) {
        reads.push(this.firestore.collection(firestoreCollections.transferEvidence).doc(input.evidenceId));
      }
      const readSnapshots = await transaction.getAll(...reads);
      const reservation = parseReservation(readSnapshots[0]);
      const existingPayment = readSnapshots[1];
      const existingClaim = readSnapshots[2];
      if (existingPayment.exists || existingClaim.exists) {
        const claim = existingClaim.data();
        if (claim?.orderId === order.id && claim?.idempotencyKey === input.idempotencyKey) {
          return { order, paymentId, replay: true };
        }
        throw new AlternativePaymentError('CONFLICT', 'This external payment reference has already been used.');
      }
      if (order.version !== input.expectedOrderVersion || order.paymentSelection.method !== method) {
        throw new AlternativePaymentError('CONFLICT', 'The order changed before payment was recorded.');
      }
      if (input.amountKobo > order.totals.amountOutstandingKobo) {
        throw new AlternativePaymentError('VALIDATION_FAILED', 'Payment exceeds the outstanding balance.');
      }
      if (method === 'manualTransfer') {
        if (order.orderStatus !== 'awaitingPayment' || reservation.state !== 'active') {
          throw new AlternativePaymentError('INVALID_STATE', 'This transfer order is no longer awaiting verification.');
        }
        if (!order.paymentSelection.manualTransferPartialAllowed && input.amountKobo !== order.totals.amountOutstandingKobo) {
          throw new AlternativePaymentError('VALIDATION_FAILED', 'A full transfer is required for this order.');
        }
      } else if (
        !['confirmed', 'processing'].includes(order.orderStatus) ||
        reservation.state !== 'committed' ||
        input.amountKobo !== order.totals.amountOutstandingKobo
      ) {
        throw new AlternativePaymentError('INVALID_STATE', 'The exact POD outstanding balance must be collected on an accepted order.');
      }
      if (input.evidenceId) {
        const evidence = transferEvidenceDocumentSchema.safeParse(readSnapshots[3]?.data());
        if (!evidence.success || evidence.data.orderId !== order.id) {
          throw new AlternativePaymentError('INVALID_STATE', 'Transfer evidence does not belong to this order.');
        }
      }
      const itemSnapshot = await transaction.get(
        orderReference.collection(firestoreCollections.orderItems),
      );
      const items = itemSnapshot.docs.map((snapshot) => {
        const parsed = orderItemDocumentSchema.safeParse(snapshot.data());
        if (!parsed.success) throw new AlternativePaymentError('INVALID_STATE', 'Order item data is invalid.');
        return parsed.data;
      });
      const now = Timestamp.now();
      const nextPaidKobo = order.totals.amountPaidKobo + input.amountKobo;
      const nextOutstandingKobo = order.totals.grandTotalKobo - nextPaidKobo;
      const completesPayment = nextOutstandingKobo === 0;
      if (method === 'manualTransfer' && completesPayment) {
        await commitCheckoutInventoryInTransaction({
          transaction,
          firestore: this.firestore,
          reservationId: order.reservationId,
          idempotencyKey: `manual-transfer-commit:${paymentId}`,
          reason: `Verified manual transfer ${input.externalReference}.`,
          actor: { actorId: actor.actorId, requestId: actor.requestId },
          now,
        });
      }
      const nextOrderDocument = orderDocumentSchema.parse({
        ...order,
        totals: {
          ...order.totals,
          amountPaidKobo: nextPaidKobo,
          amountOutstandingKobo: nextOutstandingKobo,
        },
        orderStatus: completesPayment ? 'confirmed' : order.orderStatus,
        paymentStatus: completesPayment ? 'paid' : 'partiallyPaid',
        confirmedAt: completesPayment ? order.confirmedAt ?? now : order.confirmedAt,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: order.version + 1,
      });
      const nextOrder = { id: order.id, ...nextOrderDocument };
      transaction.create(paymentReference, paymentDocumentSchema.parse({
        schemaVersion: 1,
        orderId: order.id,
        paymentAttemptId: null,
        method,
        provider: 'manual',
        providerReference,
        amountKobo: input.amountKobo,
        currency: 'NGN',
        state: 'succeeded',
        providerPaidAt: Timestamp.fromDate(input.transactionDate),
        verifiedAt: now,
        verificationSource: 'manual',
        safeResponseHash: createHash('sha256').update(JSON.stringify({
          externalReference: input.externalReference,
          amountKobo: input.amountKobo,
          transactionDate: input.transactionDate.toISOString(),
        })).digest('hex'),
        channel: method === 'pod' ? 'cash-or-authorised-collection' : 'bank-transfer',
        providerTransactionId: input.externalReference,
        deduplicationKey: `${method}:${input.externalReference}`,
        recordedBy: actor.actorId,
        createdAt: now,
      }));
      transaction.create(claimReference, {
        schemaVersion: 1,
        method,
        externalReference: input.externalReference,
        paymentId,
        orderId: order.id,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });
      transaction.set(orderReference, nextOrderDocument);
      if (completesPayment && order.confirmedAt === null) {
        writeFinancialDocumentInTransaction({
          transaction,
          firestore: this.firestore,
          order: nextOrder,
          items,
          settings: this.settings,
          documentType: 'invoice',
          amountKobo: nextOrder.totals.grandTotalKobo,
          paymentId: null,
          refundId: null,
          actorId: actor.actorId,
          now,
        });
      }
      writeFinancialDocumentInTransaction({
        transaction,
        firestore: this.firestore,
        order: nextOrder,
        items,
        settings: this.settings,
        documentType: 'receipt',
        amountKobo: input.amountKobo,
        paymentId,
        refundId: null,
        actorId: actor.actorId,
        now,
      });
      const eventType = method === 'pod' ? 'payment.podCollected' : 'payment.manualRecorded';
      transaction.create(
        orderReference.collection(firestoreCollections.orderEvents).doc(
          createDeterministicId('event', `${paymentId}:recorded`),
        ),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId: order.id,
          eventType,
          previousOrderStatus: order.orderStatus,
          nextOrderStatus: nextOrder.orderStatus,
          previousPaymentStatus: order.paymentStatus,
          nextPaymentStatus: nextOrder.paymentStatus,
          customerLabel: method === 'pod' ? 'Delivery payment recorded' : 'Bank transfer verified',
          customerNote: completesPayment ? 'Your payment is complete.' : 'A partial payment was recorded.',
          actorId: actor.actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        }),
      );
      writeOutboxEvent(transaction, this.firestore, {
        eventName: eventType,
        aggregateType: 'payment',
        aggregateId: paymentId,
        idempotencyKey: `${eventType}:${paymentId}`,
        payload: {
          orderId: order.id,
          orderReference: order.reference,
          amountKobo: input.amountKobo,
          currency: 'NGN',
        },
        now,
      });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: method === 'pod' ? 'payment.pod.record' : 'payment.transfer.record',
        entityType: 'payment',
        entityId: paymentId,
        publicReference: order.reference,
        requestId: actor.requestId,
        changedFields: ['amountPaidKobo', 'amountOutstandingKobo', 'paymentStatus'],
        reason: input.note,
      });
      return { order: nextOrder, paymentId, replay: false };
    });
  }
}

export function createAlternativePaymentService(
  firestore: Firestore = getFirebaseAdminFirestore(),
  settings: CheckoutSettings = getCheckoutSettings(),
) {
  return new FirestoreAlternativePaymentService(firestore, settings);
}
