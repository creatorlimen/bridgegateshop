import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';
import { transferEvidenceDocumentSchema } from '@/lib/schemas/manualPayment';

function safeHashEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

class FirestoreTransferEvidenceRepository {
  constructor(private readonly firestore: Firestore) {}

  async getById(evidenceId: string, proof: OrderAccessProof | null, staffCanRead: boolean) {
    const snapshot = await this.firestore
      .collection(firestoreCollections.transferEvidence)
      .doc(evidenceId)
      .get();
    const parsed = transferEvidenceDocumentSchema.safeParse(snapshot.data());
    if (!snapshot.exists || !parsed.success) return null;
    const evidence = { id: snapshot.id, ...parsed.data };
    const customer = proof?.ownerUid && evidence.ownerUid === proof.ownerUid;
    const guest = Boolean(
      proof?.guestTokenHash &&
        evidence.guestAccessTokenHash &&
        safeHashEquals(proof.guestTokenHash, evidence.guestAccessTokenHash),
    );
    return staffCanRead || customer || guest ? evidence : null;
  }

  async listForOrder(orderId: string, limit = 50) {
    const snapshot = await this.firestore
      .collection(firestoreCollections.transferEvidence)
      .where('orderId', '==', orderId)
      .limit(Math.max(1, Math.min(limit, 100)))
      .get();
    return snapshot.docs.map((documentSnapshot) => {
      const parsed = transferEvidenceDocumentSchema.safeParse(documentSnapshot.data());
      if (!parsed.success) {
        throw new Error('Transfer evidence data is invalid.');
      }
      return { id: documentSnapshot.id, ...parsed.data };
    });
  }
}

export function createTransferEvidenceRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreTransferEvidenceRepository(firestore);
}
