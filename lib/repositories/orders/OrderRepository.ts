import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  orderDocumentSchema,
  orderEventDocumentSchema,
  orderItemDocumentSchema,
  type OrderRecord,
} from '@/lib/schemas/order';
import { paymentAttemptDocumentSchema } from '@/lib/schemas/payment';

export type OrderAccessProof = {
  ownerUid: string | null;
  guestTokenHash: string | null;
};

function safeHashEquals(leftValue: string, rightValue: string) {
  const leftBuffer = Buffer.from(leftValue, 'utf8');
  const rightBuffer = Buffer.from(rightValue, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertOrderAccess(order: OrderRecord, proof: OrderAccessProof) {
  const customerMatches = proof.ownerUid !== null && order.ownerUid === proof.ownerUid;
  const guestMatches =
    proof.guestTokenHash !== null &&
    order.guestAccessTokenHash !== null &&
    safeHashEquals(proof.guestTokenHash, order.guestAccessTokenHash);

  if (!customerMatches && !guestMatches) {
    throw new Error('Order access denied.');
  }
}

class FirestoreOrderRepository {
  constructor(private readonly firestore: Firestore) {}

  async getByReference(reference: string, proof: OrderAccessProof) {
    const orderSnapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .where('reference', '==', reference)
      .limit(2)
      .get();

    if (orderSnapshot.size !== 1) {
      return null;
    }

    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.docs[0].data());

    if (!orderParse.success) {
      throw new Error('Order data is invalid.');
    }

    const order = { id: orderSnapshot.docs[0].id, ...orderParse.data };
    assertOrderAccess(order, proof);
    const orderReference = orderSnapshot.docs[0].ref;
    const [itemSnapshot, eventSnapshot, attemptSnapshot] = await Promise.all([
      orderReference.collection(firestoreCollections.orderItems).get(),
      orderReference
        .collection(firestoreCollections.orderEvents)
        .orderBy('occurredAt', 'asc')
        .limit(100)
        .get(),
      this.firestore
        .collection(firestoreCollections.paymentAttempts)
        .where('orderId', '==', order.id)
        .limit(20)
        .get(),
    ]);
    const items = itemSnapshot.docs.map((snapshot) => {
      const parsedItem = orderItemDocumentSchema.safeParse(snapshot.data());
      if (!parsedItem.success) throw new Error('Order item data is invalid.');
      return { id: snapshot.id, ...parsedItem.data };
    });
    const events = eventSnapshot.docs.map((snapshot) => {
      const parsedEvent = orderEventDocumentSchema.safeParse(snapshot.data());
      if (!parsedEvent.success) throw new Error('Order event data is invalid.');
      return { id: snapshot.id, ...parsedEvent.data };
    });
    const attempts = attemptSnapshot.docs.map((snapshot) => {
      const parsedAttempt = paymentAttemptDocumentSchema.safeParse(snapshot.data());
      if (!parsedAttempt.success) throw new Error('Payment attempt data is invalid.');
      return { id: snapshot.id, ...parsedAttempt.data };
    });

    return { order, items, events, attempts };
  }

  async listForCustomer(ownerUid: string, limit = 50) {
    const snapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .where('ownerUid', '==', ownerUid)
      .orderBy('placedAt', 'desc')
      .limit(Math.max(1, Math.min(limit, 100)))
      .get();

    return snapshot.docs.map((documentSnapshot) => {
      const parsedOrder = orderDocumentSchema.safeParse(documentSnapshot.data());
      if (!parsedOrder.success) throw new Error('Order data is invalid.');
      return { id: documentSnapshot.id, ...parsedOrder.data };
    });
  }

  async listForAdministration(limit = 100) {
    const snapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .orderBy('placedAt', 'desc')
      .limit(Math.max(1, Math.min(limit, 100)))
      .get();

    return snapshot.docs.map((documentSnapshot) => {
      const parsedOrder = orderDocumentSchema.safeParse(documentSnapshot.data());
      if (!parsedOrder.success) throw new Error('Order data is invalid.');
      return { id: documentSnapshot.id, ...parsedOrder.data };
    });
  }
}

export function createOrderRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreOrderRepository(firestore);
}

