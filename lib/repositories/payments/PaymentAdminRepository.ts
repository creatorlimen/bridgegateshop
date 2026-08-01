import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  paymentAttemptDocumentSchema,
  paymentDocumentSchema,
  paymentExceptionDocumentSchema,
  providerWebhookEventDocumentSchema,
} from '@/lib/schemas/payment';

function parseDocuments<DocumentType>(
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

class FirestorePaymentAdminRepository {
  constructor(private readonly firestore: Firestore) {}

  async getSnapshot(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const [attemptSnapshot, paymentSnapshot, exceptionSnapshot, webhookSnapshot] =
      await Promise.all([
        this.firestore
          .collection(firestoreCollections.paymentAttempts)
          .orderBy('createdAt', 'desc')
          .limit(boundedLimit)
          .get(),
        this.firestore
          .collection(firestoreCollections.payments)
          .orderBy('createdAt', 'desc')
          .limit(boundedLimit)
          .get(),
        this.firestore
          .collection(firestoreCollections.paymentExceptions)
          .orderBy('createdAt', 'desc')
          .limit(boundedLimit)
          .get(),
        this.firestore
          .collection(firestoreCollections.providerWebhookEvents)
          .orderBy('receivedAt', 'desc')
          .limit(boundedLimit)
          .get(),
      ]);

    return {
      attempts: parseDocuments(attemptSnapshot, paymentAttemptDocumentSchema, 'Payment attempt'),
      payments: parseDocuments(paymentSnapshot, paymentDocumentSchema, 'Payment'),
      exceptions: parseDocuments(exceptionSnapshot, paymentExceptionDocumentSchema, 'Payment exception'),
      webhookEvents: parseDocuments(webhookSnapshot, providerWebhookEventDocumentSchema, 'Webhook event'),
    };
  }
}

export function createPaymentAdminRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestorePaymentAdminRepository(firestore);
}

