import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  deliveryDocumentSchema,
  deliveryEventDocumentSchema,
  deliveryExceptionDocumentSchema,
} from '@/lib/schemas/fulfilment';
import { orderDocumentSchema } from '@/lib/schemas/order';

class FirestoreDeliveryRepository {
  constructor(private readonly firestore: Firestore) {}

  async listForAdministration(limit = 100) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const [deliverySnapshot, exceptionSnapshot] = await Promise.all([
      this.firestore
        .collection(firestoreCollections.deliveries)
        .orderBy('updatedAt', 'desc')
        .limit(safeLimit)
        .get(),
      this.firestore
        .collection(firestoreCollections.deliveryExceptions)
        .where('state', '==', 'open')
        .limit(500)
        .get(),
    ]);
    const exceptionCounts = new Map<string, number>();
    exceptionSnapshot.docs.forEach((snapshot) => {
      const parsed = deliveryExceptionDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) return;
      exceptionCounts.set(
        parsed.data.deliveryId,
        (exceptionCounts.get(parsed.data.deliveryId) ?? 0) + 1,
      );
    });
    return deliverySnapshot.docs.map((snapshot) => {
      const parsed = deliveryDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) throw new Error('Delivery data is invalid.');
      return {
        id: snapshot.id,
        ...parsed.data,
        openExceptionCount: exceptionCounts.get(snapshot.id) ?? 0,
      };
    });
  }

  async getAdministrationSnapshot(deliveryId: string) {
    const deliveryReference = this.firestore
      .collection(firestoreCollections.deliveries)
      .doc(deliveryId);
    const deliverySnapshot = await deliveryReference.get();
    if (!deliverySnapshot.exists) return null;
    const deliveryParse = deliveryDocumentSchema.safeParse(deliverySnapshot.data());
    if (!deliveryParse.success) throw new Error('Delivery data is invalid.');
    const delivery = { id: deliverySnapshot.id, ...deliveryParse.data };
    const [orderSnapshot, eventSnapshot, exceptionSnapshot] = await Promise.all([
      this.firestore
        .collection(firestoreCollections.orders)
        .doc(delivery.orderId)
        .get(),
      deliveryReference
        .collection(firestoreCollections.deliveryEvents)
        .orderBy('occurredAt', 'asc')
        .limit(100)
        .get(),
      this.firestore
        .collection(firestoreCollections.deliveryExceptions)
        .where('deliveryId', '==', delivery.id)
        .limit(100)
        .get(),
    ]);
    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
    if (!orderSnapshot.exists || !orderParse.success) {
      throw new Error('Delivery order data is invalid.');
    }
    const events = eventSnapshot.docs.map((snapshot) => {
      const parsed = deliveryEventDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) throw new Error('Delivery event data is invalid.');
      return { id: snapshot.id, ...parsed.data };
    });
    const exceptions = exceptionSnapshot.docs.map((snapshot) => {
      const parsed = deliveryExceptionDocumentSchema.safeParse(snapshot.data());
      if (!parsed.success) throw new Error('Delivery exception data is invalid.');
      return { id: snapshot.id, ...parsed.data };
    });
    return {
      delivery,
      order: { id: orderSnapshot.id, ...orderParse.data },
      events,
      exceptions,
    };
  }
}

export function createDeliveryRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreDeliveryRepository(firestore);
}
