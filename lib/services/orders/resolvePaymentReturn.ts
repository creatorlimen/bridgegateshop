import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { orderDocumentSchema } from '@/lib/schemas/order';
import { paymentAttemptDocumentSchema } from '@/lib/schemas/payment';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';

function safeHashEquals(leftValue: string, rightValue: string) {
  const leftBuffer = Buffer.from(leftValue, 'utf8');
  const rightBuffer = Buffer.from(rightValue, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function resolvePaystackReturnToOrder(
  providerReference: string,
  accessProof: OrderAccessProof,
) {
  const firestore = getFirebaseAdminFirestore();
  const attemptSnapshot = await firestore
    .collection(firestoreCollections.paymentAttempts)
    .where('providerReference', '==', providerReference)
    .limit(2)
    .get();

  if (attemptSnapshot.size !== 1) {
    return null;
  }

  const attemptParse = paymentAttemptDocumentSchema.safeParse(
    attemptSnapshot.docs[0].data(),
  );

  if (!attemptParse.success) {
    return null;
  }

  const orderSnapshot = await firestore
    .collection(firestoreCollections.orders)
    .doc(attemptParse.data.orderId)
    .get();
  const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());

  if (!orderSnapshot.exists || !orderParse.success) {
    return null;
  }

  const customerMatches =
    accessProof.ownerUid !== null &&
    orderParse.data.ownerUid === accessProof.ownerUid;
  const guestMatches =
    accessProof.guestTokenHash !== null &&
    orderParse.data.guestAccessTokenHash !== null &&
    safeHashEquals(
      accessProof.guestTokenHash,
      orderParse.data.guestAccessTokenHash,
    );

  return customerMatches || guestMatches ? orderParse.data.reference : null;
}

