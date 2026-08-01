import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { productVariantDocumentSchema } from '@/lib/schemas/catalogue';
import { inventoryBalanceDocumentSchema } from '@/lib/schemas/inventory';
import { orderDocumentSchema, orderItemDocumentSchema } from '@/lib/schemas/order';
import { refundDocumentSchema } from '@/lib/schemas/refund';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { createInventoryService } from '@/lib/services/inventory/InventoryService';
import { writeOutboxEvent } from '@/lib/services/outbox/writeOutboxEvent';

type ReturnActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

export class ReturnStockError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_STATE', message: string) {
    super(message);
    this.name = 'ReturnStockError';
  }
}

class FirestoreReturnStockService {
  constructor(private readonly firestore: Firestore) {}

  async acceptFullReturn(refundId: string, reason: string, actor: ReturnActor) {
    const refundReference = this.firestore.collection(firestoreCollections.refunds).doc(refundId);
    const decisionReference = this.firestore.collection(firestoreCollections.returnStockDecisions).doc(refundId);
    const claim = await this.firestore.runTransaction(async (transaction) => {
      const [refundSnapshot, decisionSnapshot] = await transaction.getAll(refundReference, decisionReference);
      const refundParse = refundDocumentSchema.safeParse(refundSnapshot.data());
      if (!refundSnapshot.exists || !refundParse.success) throw new ReturnStockError('NOT_FOUND', 'Refund was not found.');
      const refund = { id: refundSnapshot.id, ...refundParse.data };
      if (refund.stockDecision === 'acceptedReturnRestocked') return { refund, replay: true };
      if (refund.state !== 'processed') throw new ReturnStockError('INVALID_STATE', 'Only a processed refund can receive returned stock.');
      if (!decisionSnapshot.exists) {
        transaction.create(decisionReference, {
          schemaVersion: 1,
          refundId,
          orderId: refund.orderId,
          state: 'processing',
          reason,
          actorId: actor.actorId,
          createdAt: Timestamp.now(),
        });
      }
      return { refund, replay: decisionSnapshot.exists };
    });
    if (claim.refund.stockDecision === 'acceptedReturnRestocked') return claim;

    const orderReference = this.firestore.collection(firestoreCollections.orders).doc(claim.refund.orderId);
    const [orderSnapshot, itemsSnapshot] = await Promise.all([
      orderReference.get(),
      orderReference.collection(firestoreCollections.orderItems).get(),
    ]);
    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
    if (!orderSnapshot.exists || !orderParse.success) throw new ReturnStockError('INVALID_STATE', 'Order data is invalid.');
    if (!['delivered', 'collected'].includes(orderParse.data.fulfilmentStatus) && orderParse.data.orderStatus !== 'completed') {
      throw new ReturnStockError('INVALID_STATE', 'Physical return acceptance requires a fulfilled order.');
    }
    const items = itemsSnapshot.docs.map((snapshot) => {
      const parsed = orderItemDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) throw new ReturnStockError('INVALID_STATE', 'Order item data is invalid.');
      return parsed.data;
    });
    const variantSnapshots = await this.firestore.getAll(
      ...items.map((item) => this.firestore.collection(firestoreCollections.productVariants).doc(item.variantId)),
    );
    const managedItems = items.filter((_item, index) => {
      const parsed = productVariantDocumentSchema.safeParse(variantSnapshots[index].data());
      if (!variantSnapshots[index].exists || !parsed.success) throw new ReturnStockError('INVALID_STATE', 'Product variant data is invalid.');
      return parsed.data.stockManaged;
    });
    for (const item of managedItems) {
      const balanceSnapshot = await this.firestore.collection(firestoreCollections.inventoryBalances).doc(item.variantId).get();
      const balanceParse = inventoryBalanceDocumentSchema.safeParse(balanceSnapshot.data());
      if (!balanceSnapshot.exists || !balanceParse.success) throw new ReturnStockError('INVALID_STATE', 'Inventory balance data is invalid.');
      await createInventoryService(this.firestore).adjustBalance(
        {
          variantId: item.variantId,
          expectedVersion: balanceParse.data.version,
          quantityDelta: item.quantity,
          movementType: 'return',
          reason,
          idempotencyKey: `accepted-return:${refundId}:${item.variantId}`,
        },
        actor,
      );
    }

    return this.firestore.runTransaction(async (transaction) => {
      const refundSnapshot = await transaction.get(refundReference);
      const refundParse = refundDocumentSchema.safeParse(refundSnapshot.data());
      if (!refundParse.success) throw new ReturnStockError('INVALID_STATE', 'Refund data is invalid.');
      if (refundParse.data.stockDecision === 'acceptedReturnRestocked') {
        return { refund: { id: refundId, ...refundParse.data }, replay: true };
      }
      const now = Timestamp.now();
      const nextRefund = refundDocumentSchema.parse({
        ...refundParse.data,
        stockDecision: 'acceptedReturnRestocked',
        updatedAt: now,
        updatedBy: actor.actorId,
        version: refundParse.data.version + 1,
      });
      transaction.set(refundReference, nextRefund);
      transaction.set(decisionReference, { state: 'completed', completedAt: now }, { merge: true });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'refund.return.acceptAndRestock',
        entityType: 'refund',
        entityId: refundId,
        publicReference: refundParse.data.orderReference,
        requestId: actor.requestId,
        changedFields: ['stockDecision'],
        reason,
      });
      writeOutboxEvent(transaction, this.firestore, {
        eventName: 'refund.returnRestocked',
        aggregateType: 'refund',
        aggregateId: refundId,
        idempotencyKey: `refund-return-restocked:${refundId}`,
        payload: {
          orderId: refundParse.data.orderId,
          orderReference: refundParse.data.orderReference,
          refundId,
          currency: refundParse.data.currency,
          amountKobo: refundParse.data.amountKobo,
        },
        now,
      });
      return { refund: { id: refundId, ...nextRefund }, replay: false };
    });
  }
}

export function createReturnStockService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreReturnStockService(firestore);
}
