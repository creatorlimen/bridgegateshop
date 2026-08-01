import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';
import { financialDocumentSchema } from '@/lib/schemas/financial';
import { transferInstructionDocumentSchema } from '@/lib/schemas/manualPayment';
import { orderDocumentSchema, orderEventDocumentSchema, orderItemDocumentSchema, type OrderRecord } from '@/lib/schemas/order';
import { paymentDocumentSchema } from '@/lib/schemas/payment';
import { refundDocumentSchema } from '@/lib/schemas/refund';

function parseMany<DocumentType>(
  snapshot: FirebaseFirestore.QuerySnapshot,
  schema: { safeParse(value: unknown): { success: true; data: DocumentType } | { success: false } },
  label: string,
) {
  return snapshot.docs.map((documentSnapshot) => {
    const parsed = schema.safeParse(documentSnapshot.data());
    if (!parsed.success) throw new Error(`${label} data is invalid.`);
    return { id: documentSnapshot.id, ...parsed.data };
  });
}

function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertAccess(order: OrderRecord, proof: OrderAccessProof) {
  const customer = proof.ownerUid !== null && order.ownerUid === proof.ownerUid;
  const guest = Boolean(
    proof.guestTokenHash &&
      order.guestAccessTokenHash &&
      safeHashEquals(proof.guestTokenHash, order.guestAccessTokenHash),
  );
  if (!customer && !guest) throw new Error('Order access denied.');
}

class FirestoreOrderFinancialRepository {
  constructor(private readonly firestore: Firestore) {}

  async getCustomerSnapshot(order: OrderRecord, proof: OrderAccessProof) {
    assertAccess(order, proof);
    return this.loadFinancialState(order);
  }

  async getAdministrationSnapshot(orderId: string) {
    const orderSnapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .doc(orderId)
      .get();
    const parsed = orderDocumentSchema.safeParse(orderSnapshot.data());
    if (!orderSnapshot.exists || !parsed.success) return null;
    const order = { id: orderSnapshot.id, ...parsed.data };
    const financial = await this.loadFinancialState(order);
    const [itemsSnapshot, eventsSnapshot] = await Promise.all([
      orderSnapshot.ref.collection(firestoreCollections.orderItems).get(),
      orderSnapshot.ref
        .collection(firestoreCollections.orderEvents)
        .orderBy('occurredAt', 'asc')
        .limit(200)
        .get(),
    ]);
    return {
      order,
      ...financial,
      items: parseMany(itemsSnapshot, orderItemDocumentSchema, 'Order item'),
      events: parseMany(eventsSnapshot, orderEventDocumentSchema, 'Order event'),
    };
  }

  private async loadFinancialState(order: OrderRecord) {
    const [paymentsSnapshot, refundsSnapshot, documentsSnapshot, instructionsSnapshot] =
      await Promise.all([
        this.firestore
          .collection(firestoreCollections.payments)
          .where('orderId', '==', order.id)
          .limit(100)
          .get(),
        this.firestore
          .collection(firestoreCollections.refunds)
          .where('orderId', '==', order.id)
          .limit(100)
          .get(),
        this.firestore
          .collection(firestoreCollections.financialDocuments)
          .where('orderId', '==', order.id)
          .limit(100)
          .get(),
        this.firestore
          .collection(firestoreCollections.transferInstructions)
          .doc(order.id)
          .get(),
      ]);
    const instructionsParse = transferInstructionDocumentSchema.safeParse(
      instructionsSnapshot.data(),
    );
    return {
      payments: parseMany(paymentsSnapshot, paymentDocumentSchema, 'Payment'),
      refunds: parseMany(refundsSnapshot, refundDocumentSchema, 'Refund'),
      documents: parseMany(documentsSnapshot, financialDocumentSchema, 'Financial document'),
      transferInstructions:
        instructionsSnapshot.exists && instructionsParse.success
          ? instructionsParse.data
          : null,
    };
  }
}

export function createOrderFinancialRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreOrderFinancialRepository(firestore);
}
