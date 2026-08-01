import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { Role } from '@/lib/auth/roles';
import {
  getCheckoutSettings,
  type CheckoutSettings,
} from '@/lib/config/checkoutSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';
import {
  orderDocumentSchema,
  orderEventDocumentSchema,
  orderItemDocumentSchema,
} from '@/lib/schemas/order';
import { paymentDocumentSchema } from '@/lib/schemas/payment';
import {
  refundDocumentSchema,
  requestRefundInputSchema,
} from '@/lib/schemas/refund';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { writeOutboxEvent } from '@/lib/services/outbox/writeOutboxEvent';
import { writeFinancialDocumentInTransaction } from '@/lib/services/payments/FinancialDocumentService';
import {
  PaystackClient,
  type RefundProvider,
} from '@/lib/services/payments/PaystackClient';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

export class RefundMutationError extends Error {
  constructor(
    readonly code:
      | 'PERMISSION_DENIED'
      | 'VALIDATION_FAILED'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'INVALID_STATE'
      | 'PROVIDER_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'RefundMutationError';
  }
}

type RefundStaffActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

const reviewRefundInputSchema = z.object({
  refundId: z.string().min(1).max(128),
  decision: z.enum(['approved', 'rejected']),
  expectedOrderVersion: z.number().int().positive(),
  resolutionNote: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

const refundOutcomeInputSchema = z.object({
  refundId: z.string().min(1).max(128),
  outcome: z.enum(['processed', 'failed']),
  providerRefundId: z.string().trim().min(1).max(120),
  resolutionNote: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseOrder(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = orderDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new RefundMutationError(snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND', 'Order data is invalid.');
  }
  return { id: snapshot.id, ...parsed.data };
}

function parseRefund(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = refundDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new RefundMutationError(snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND', 'Refund data is invalid.');
  }
  return { id: snapshot.id, ...parsed.data };
}

function getReservedRefundTotal(
  snapshots: FirebaseFirestore.QuerySnapshot,
) {
  return snapshots.docs.reduce((total, snapshot) => {
    const parsed = refundDocumentSchema.safeParse(snapshot.data());
    if (!parsed.success) {
      throw new RefundMutationError('INVALID_STATE', 'Stored refund data is invalid.');
    }
    return ['requested', 'approved', 'processing', 'processed'].includes(parsed.data.state)
      ? total + parsed.data.amountKobo
      : total;
  }, 0);
}

function assertOrderAccess(
  order: ReturnType<typeof parseOrder>,
  proof: OrderAccessProof,
) {
  const ownerMatches = proof.ownerUid !== null && order.ownerUid === proof.ownerUid;
  const guestMatches = Boolean(
    proof.guestTokenHash &&
      order.guestAccessTokenHash &&
      safeHashEquals(proof.guestTokenHash, order.guestAccessTokenHash),
  );
  if (!ownerMatches && !guestMatches) {
    throw new RefundMutationError('PERMISSION_DENIED', 'The order could not be verified.');
  }
}

class FirestoreRefundService {
  constructor(
    private readonly firestore: Firestore,
    private readonly provider: RefundProvider,
    private readonly settings: CheckoutSettings,
  ) {}

  async requestRefund(
    unparsedInput: z.input<typeof requestRefundInputSchema>,
    proof: OrderAccessProof,
  ) {
    const input = requestRefundInputSchema.parse(unparsedInput);
    const refundId = createDeterministicId(
      'refund',
      `${input.orderId}:${input.paymentId}:${input.idempotencyKey}`,
    );
    const orderReference = this.firestore.collection(firestoreCollections.orders).doc(input.orderId);
    const paymentReference = this.firestore.collection(firestoreCollections.payments).doc(input.paymentId);
    const refundReference = this.firestore.collection(firestoreCollections.refunds).doc(refundId);

    return this.firestore.runTransaction(async (transaction) => {
      const [orderSnapshot, paymentSnapshot, refundSnapshot] = await transaction.getAll(
        orderReference,
        paymentReference,
        refundReference,
      );
      const order = parseOrder(orderSnapshot);
      assertOrderAccess(order, proof);
      if (refundSnapshot.exists) return { refund: parseRefund(refundSnapshot), replay: true };
      const paymentParse = paymentDocumentSchema.safeParse(paymentSnapshot.data());
      if (!paymentSnapshot.exists || !paymentParse.success || paymentParse.data.orderId !== order.id || paymentParse.data.state !== 'succeeded') {
        throw new RefundMutationError('INVALID_STATE', 'Only a successful payment on this order can be refunded.');
      }
      const paymentRefunds = await transaction.get(
        this.firestore.collection(firestoreCollections.refunds).where('paymentId', '==', paymentSnapshot.id),
      );
      if (getReservedRefundTotal(paymentRefunds) + input.amountKobo > paymentParse.data.amountKobo) {
        throw new RefundMutationError('VALIDATION_FAILED', 'The requested refund exceeds this payment.');
      }
      const refundableKobo = order.totals.amountPaidKobo - order.refundTotalKobo - order.refundPendingKobo;
      if (input.amountKobo > refundableKobo) {
        throw new RefundMutationError('VALIDATION_FAILED', 'The requested refund exceeds the available paid value.');
      }
      const now = Timestamp.now();
      const actorId = proof.ownerUid ?? 'system:guest-customer';
      const refundDocument = refundDocumentSchema.parse({
        schemaVersion: 1,
        orderId: order.id,
        orderReference: order.reference,
        paymentId: paymentSnapshot.id,
        amountKobo: input.amountKobo,
        currency: 'NGN',
        reason: input.reason,
        state: 'requested',
        requestedBy: actorId,
        requestedAt: now,
        approvedBy: null,
        approvedAt: null,
        processedAt: null,
        provider: paymentParse.data.provider,
        providerRefundId: null,
        providerTransactionReference: paymentParse.data.providerReference,
        providerState: null,
        failureCode: null,
        resolutionNote: null,
        stockDecision: 'notRestocked',
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        version: 1,
      });
      transaction.create(refundReference, refundDocument);
      transaction.create(
        orderReference.collection(firestoreCollections.orderEvents).doc(
          createDeterministicId('event', `${refundId}:requested`),
        ),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId: order.id,
          eventType: 'refund.requested',
          previousOrderStatus: order.orderStatus,
          nextOrderStatus: order.orderStatus,
          previousPaymentStatus: order.paymentStatus,
          nextPaymentStatus: order.paymentStatus,
          customerLabel: 'Refund requested',
          customerNote: 'Your refund request is awaiting review.',
          actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        }),
      );
      writeOutboxEvent(transaction, this.firestore, {
        eventName: 'refund.requested',
        aggregateType: 'refund',
        aggregateId: refundId,
        idempotencyKey: `refund-requested:${refundId}`,
        payload: {
          orderId: order.id,
          orderReference: order.reference,
          amountKobo: input.amountKobo,
          currency: 'NGN',
        },
        now,
      });
      return { refund: { id: refundId, ...refundDocument }, replay: false };
    });
  }

  async reviewRefund(
    unparsedInput: z.input<typeof reviewRefundInputSchema>,
    actor: RefundStaffActor,
  ) {
    const input = reviewRefundInputSchema.parse(unparsedInput);
    const refundReference = this.firestore.collection(firestoreCollections.refunds).doc(input.refundId);
    return this.firestore.runTransaction(async (transaction) => {
      const refund = parseRefund(await transaction.get(refundReference));
      const orderReference = this.firestore.collection(firestoreCollections.orders).doc(refund.orderId);
      const paymentReference = this.firestore.collection(firestoreCollections.payments).doc(refund.paymentId);
      const [orderSnapshot, paymentSnapshot] = await transaction.getAll(orderReference, paymentReference);
      const order = parseOrder(orderSnapshot);
      const paymentParse = paymentDocumentSchema.safeParse(paymentSnapshot.data());
      if (!paymentSnapshot.exists || !paymentParse.success || paymentParse.data.orderId !== order.id) {
        throw new RefundMutationError('INVALID_STATE', 'Refund payment data is invalid.');
      }
      if (refund.state === input.decision && refund.resolutionNote === input.resolutionNote) {
        return { refund, order, replay: true };
      }
      if (refund.state !== 'requested' || order.version !== input.expectedOrderVersion) {
        throw new RefundMutationError('CONFLICT', 'The refund or order changed before review.');
      }
      const now = Timestamp.now();
      if (input.decision === 'approved') {
        const paymentRefunds = await transaction.get(
          this.firestore.collection(firestoreCollections.refunds).where('paymentId', '==', refund.paymentId),
        );
        if (getReservedRefundTotal(paymentRefunds) > paymentParse.data.amountKobo) {
          throw new RefundMutationError('VALIDATION_FAILED', 'Approved refunds exceed the source payment.');
        }
        const refundableKobo = order.totals.amountPaidKobo - order.refundTotalKobo - order.refundPendingKobo;
        if (refund.amountKobo > refundableKobo) {
          throw new RefundMutationError('VALIDATION_FAILED', 'The approved refund exceeds remaining paid value.');
        }
      }
      const nextRefundDocument = refundDocumentSchema.parse({
        ...refund,
        state: input.decision,
        approvedBy: input.decision === 'approved' ? actor.actorId : null,
        approvedAt: input.decision === 'approved' ? now : null,
        resolutionNote: input.resolutionNote,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: refund.version + 1,
      });
      const nextOrderDocument = orderDocumentSchema.parse({
        ...order,
        refundPendingKobo:
          input.decision === 'approved'
            ? order.refundPendingKobo + refund.amountKobo
            : order.refundPendingKobo,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: order.version + 1,
      });
      transaction.set(refundReference, nextRefundDocument);
      transaction.set(orderReference, nextOrderDocument);
      transaction.create(
        orderReference.collection(firestoreCollections.orderEvents).doc(
          createDeterministicId('event', `${refund.id}:${input.decision}:${input.idempotencyKey}`),
        ),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId: order.id,
          eventType: input.decision === 'approved' ? 'refund.approved' : 'refund.rejected',
          previousOrderStatus: order.orderStatus,
          nextOrderStatus: order.orderStatus,
          previousPaymentStatus: order.paymentStatus,
          nextPaymentStatus: order.paymentStatus,
          customerLabel: input.decision === 'approved' ? 'Refund approved' : 'Refund not approved',
          customerNote: input.resolutionNote,
          actorId: actor.actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        }),
      );
      writeOutboxEvent(transaction, this.firestore, {
        eventName: `refund.${input.decision}`,
        aggregateType: 'refund',
        aggregateId: refund.id,
        idempotencyKey: `refund-${input.decision}:${refund.id}:${input.idempotencyKey}`,
        payload: {
          orderId: order.id,
          orderReference: order.reference,
          amountKobo: refund.amountKobo,
          currency: 'NGN',
        },
        now,
      });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: `refund.${input.decision}`,
        entityType: 'refund',
        entityId: refund.id,
        publicReference: order.reference,
        requestId: actor.requestId,
        changedFields: ['state', 'refundPendingKobo'],
        reason: input.resolutionNote,
      });
      return {
        refund: { id: refund.id, ...nextRefundDocument },
        order: { id: order.id, ...nextOrderDocument },
        replay: false,
      };
    });
  }

  async processApprovedRefund(refundId: string, actor: RefundStaffActor) {
    const refundReference = this.firestore.collection(firestoreCollections.refunds).doc(refundId);
    const claim = await this.firestore.runTransaction(async (transaction) => {
      const refund = parseRefund(await transaction.get(refundReference));
      if (refund.state === 'processing') return { refund, replay: true };
      if (refund.state !== 'approved') {
        throw new RefundMutationError('INVALID_STATE', 'Only an approved refund can be processed.');
      }
      const now = Timestamp.now();
      const next = refundDocumentSchema.parse({
        ...refund,
        state: 'processing',
        updatedAt: now,
        updatedBy: actor.actorId,
        version: refund.version + 1,
      });
      transaction.set(refundReference, next);
      writeOutboxEvent(transaction, this.firestore, {
        eventName: 'refund.processing',
        aggregateType: 'refund',
        aggregateId: refund.id,
        idempotencyKey: `refund-processing:${refund.id}:${refund.version + 1}`,
        payload: {
          orderId: refund.orderId,
          orderReference: refund.orderReference,
          amountKobo: refund.amountKobo,
          currency: 'NGN',
        },
        now,
      });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'refund.processing',
        entityType: 'refund',
        entityId: refund.id,
        publicReference: refund.orderReference,
        requestId: actor.requestId,
        changedFields: ['state'],
      });
      return { refund: { id: refund.id, ...next }, replay: false };
    });
    if (claim.replay || claim.refund.provider === 'manual') return claim;

    let providerResult;
    try {
      providerResult = await this.provider.createRefund({
        transactionReference: claim.refund.providerTransactionReference,
        amountKobo: claim.refund.amountKobo,
        currency: 'NGN',
        customerNote: claim.refund.reason,
        merchantNote: `Bridgegate order ${claim.refund.orderReference}; refund ${claim.refund.id}`,
      });
    } catch {
      throw new RefundMutationError(
        'PROVIDER_UNAVAILABLE',
        'Refund processing is pending reconciliation; do not submit it again.',
      );
    }

    await this.firestore.runTransaction(async (transaction) => {
      const current = parseRefund(await transaction.get(refundReference));
      if (current.state !== 'processing' || current.providerRefundId) return;
      transaction.set(refundReference, refundDocumentSchema.parse({
        ...current,
        providerRefundId: providerResult.providerRefundId,
        providerState: providerResult.status,
        resolutionNote: providerResult.safeMessage,
        updatedAt: Timestamp.now(),
        updatedBy: 'system:paystack-refund',
        version: current.version + 1,
      }));
    });

    if (providerResult.status === 'processed') {
      return this.recordRefundOutcome({
        refundId,
        outcome: 'processed',
        providerRefundId: providerResult.providerRefundId,
        resolutionNote: providerResult.safeMessage,
        idempotencyKey: `provider-refund:${providerResult.providerRefundId}`,
      }, actor);
    }
    return { refund: claim.refund, replay: false };
  }

  async recordRefundOutcome(
    unparsedInput: z.input<typeof refundOutcomeInputSchema>,
    actor: RefundStaffActor,
  ) {
    const input = refundOutcomeInputSchema.parse(unparsedInput);
    const refundReference = this.firestore.collection(firestoreCollections.refunds).doc(input.refundId);
    return this.firestore.runTransaction(async (transaction) => {
      const refund = parseRefund(await transaction.get(refundReference));
      const orderReference = this.firestore.collection(firestoreCollections.orders).doc(refund.orderId);
      const order = parseOrder(await transaction.get(orderReference));
      if (refund.state === input.outcome) return { refund, order, replay: true };
      if (refund.state !== 'processing') {
        throw new RefundMutationError('INVALID_STATE', 'Only a processing refund can receive an outcome.');
      }
      const itemSnapshot = await transaction.get(orderReference.collection(firestoreCollections.orderItems));
      const items = itemSnapshot.docs.map((snapshot) => {
        const parsed = orderItemDocumentSchema.safeParse(snapshot.data());
        if (!parsed.success) throw new RefundMutationError('INVALID_STATE', 'Order item data is invalid.');
        return parsed.data;
      });
      const now = Timestamp.now();
      const processed = input.outcome === 'processed';
      const nextRefundTotalKobo = processed
        ? order.refundTotalKobo + refund.amountKobo
        : order.refundTotalKobo;
      const nextPaymentStatus = processed
        ? nextRefundTotalKobo === order.totals.amountPaidKobo
          ? 'refunded'
          : 'partiallyRefunded'
        : order.paymentStatus;
      const nextOrderDocument = orderDocumentSchema.parse({
        ...order,
        refundPendingKobo: order.refundPendingKobo - refund.amountKobo,
        refundTotalKobo: nextRefundTotalKobo,
        paymentStatus: nextPaymentStatus,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: order.version + 1,
      });
      const nextRefundDocument = refundDocumentSchema.parse({
        ...refund,
        state: input.outcome,
        providerRefundId: input.providerRefundId,
        providerState: input.outcome,
        processedAt: processed ? now : null,
        failureCode: processed ? null : 'PROVIDER_FAILED',
        resolutionNote: input.resolutionNote,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: refund.version + 1,
      });
      const nextOrder = { id: order.id, ...nextOrderDocument };
      transaction.set(orderReference, nextOrderDocument);
      transaction.set(refundReference, nextRefundDocument);
      if (processed) {
        writeFinancialDocumentInTransaction({
          transaction,
          firestore: this.firestore,
          order: nextOrder,
          items,
          settings: this.settings,
          documentType: 'creditNote',
          amountKobo: refund.amountKobo,
          paymentId: refund.paymentId,
          refundId: refund.id,
          actorId: actor.actorId,
          now,
        });
      }
      transaction.create(
        orderReference.collection(firestoreCollections.orderEvents).doc(
          createDeterministicId('event', `${refund.id}:${input.outcome}:${input.idempotencyKey}`),
        ),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId: order.id,
          eventType: processed ? 'refund.processed' : 'refund.failed',
          previousOrderStatus: order.orderStatus,
          nextOrderStatus: order.orderStatus,
          previousPaymentStatus: order.paymentStatus,
          nextPaymentStatus,
          customerLabel: processed ? 'Refund processed' : 'Refund processing failed',
          customerNote: input.resolutionNote,
          actorId: actor.actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        }),
      );
      writeOutboxEvent(transaction, this.firestore, {
        eventName: `refund.${input.outcome}`,
        aggregateType: 'refund',
        aggregateId: refund.id,
        idempotencyKey: `refund-${input.outcome}:${refund.id}:${input.idempotencyKey}`,
        payload: {
          orderId: order.id,
          orderReference: order.reference,
          amountKobo: refund.amountKobo,
          currency: 'NGN',
        },
        now,
      });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: `refund.${input.outcome}`,
        entityType: 'refund',
        entityId: refund.id,
        publicReference: order.reference,
        requestId: actor.requestId,
        changedFields: ['state', 'refundTotalKobo', 'refundPendingKobo', 'paymentStatus'],
        reason: input.resolutionNote,
      });
      return {
        refund: { id: refund.id, ...nextRefundDocument },
        order: nextOrder,
        replay: false,
      };
    });
  }
}

export function createRefundService(
  firestore: Firestore = getFirebaseAdminFirestore(),
  provider: RefundProvider = new PaystackClient(),
  settings: CheckoutSettings = getCheckoutSettings(),
) {
  return new FirestoreRefundService(firestore, provider, settings);
}
