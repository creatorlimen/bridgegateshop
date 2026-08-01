import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  financialDocumentSchema,
  type FinancialDocumentRecord,
} from '@/lib/schemas/financial';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';

function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hasAccess(document: FinancialDocumentRecord, proof: OrderAccessProof | null) {
  if (!proof) return false;
  if (proof.ownerUid && document.ownerUid === proof.ownerUid) return true;
  return Boolean(
    proof.guestTokenHash &&
      document.guestAccessTokenHash &&
      safeHashEquals(proof.guestTokenHash, document.guestAccessTokenHash),
  );
}

function parseDocument(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = financialDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) return null;
  return { id: snapshot.id, ...parsed.data };
}

class FirestoreFinancialDocumentRepository {
  constructor(private readonly firestore: Firestore) {}

  async getById(
    documentId: string,
    proof: OrderAccessProof | null,
    staffCanRead: boolean,
  ) {
    const document = parseDocument(
      await this.firestore
        .collection(firestoreCollections.financialDocuments)
        .doc(documentId)
        .get(),
    );
    if (!document || (!staffCanRead && !hasAccess(document, proof))) return null;
    return document;
  }

  async listForOrder(orderId: string, proof: OrderAccessProof) {
    const snapshot = await this.firestore
      .collection(firestoreCollections.financialDocuments)
      .where('orderId', '==', orderId)
      .limit(50)
      .get();
    return snapshot.docs
      .map(parseDocument)
      .filter((document): document is FinancialDocumentRecord => Boolean(document))
      .filter((document) => hasAccess(document, proof))
      .sort((left, right) => right.issuedAtIso.localeCompare(left.issuedAtIso));
  }

  async listForCustomer(ownerUid: string, limit = 100) {
    const snapshot = await this.firestore
      .collection(firestoreCollections.financialDocuments)
      .where('ownerUid', '==', ownerUid)
      .orderBy('issuedAt', 'desc')
      .limit(Math.max(1, Math.min(limit, 100)))
      .get();
    return snapshot.docs
      .map(parseDocument)
      .filter((document): document is FinancialDocumentRecord => Boolean(document));
  }
}

export function createFinancialDocumentRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreFinancialDocumentRepository(firestore);
}
