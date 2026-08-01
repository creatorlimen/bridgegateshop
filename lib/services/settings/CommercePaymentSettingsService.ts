import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  commercePaymentSettingsDocumentSchema,
  type CommercePaymentSettingsDocument,
} from '@/lib/schemas/commerceSettings';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';

type SettingsActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

type SaveSettingsInput = Pick<
  CommercePaymentSettingsDocument,
  'pod' | 'manualTransfer' | 'financialDocuments'
> & { expectedVersion: number };

export class CommerceSettingsError extends Error {
  constructor(readonly code: 'CONFLICT' | 'INVALID_STATE', message: string) {
    super(message);
    this.name = 'CommerceSettingsError';
  }
}

class FirestoreCommercePaymentSettingsService {
  constructor(private readonly firestore: Firestore) {}

  async getRecord() {
    const snapshot = await this.firestore
      .collection(firestoreCollections.commerceSettings)
      .doc('payments')
      .get();
    if (!snapshot.exists) return null;
    const parsed = commercePaymentSettingsDocumentSchema.safeParse(snapshot.data());
    if (!parsed.success) throw new CommerceSettingsError('INVALID_STATE', 'Stored payment settings are invalid.');
    return parsed.data;
  }

  async save(input: SaveSettingsInput, actor: SettingsActor) {
    const reference = this.firestore
      .collection(firestoreCollections.commerceSettings)
      .doc('payments');
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existingParse = snapshot.exists
        ? commercePaymentSettingsDocumentSchema.safeParse(snapshot.data())
        : null;
      if (snapshot.exists && !existingParse?.success) {
        throw new CommerceSettingsError('INVALID_STATE', 'Stored payment settings are invalid.');
      }
      const existing = existingParse?.success ? existingParse.data : null;
      const currentVersion = existing?.version ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw new CommerceSettingsError('CONFLICT', 'Payment settings changed before this update.');
      }
      const now = Timestamp.now();
      const nextVersion = currentVersion + 1;
      const document = commercePaymentSettingsDocumentSchema.parse({
        schemaVersion: 1,
        settingsKey: 'payments',
        configurationVersion: `payments-v${nextVersion}`,
        pod: input.pod,
        manualTransfer: input.manualTransfer,
        financialDocuments: input.financialDocuments,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: nextVersion,
      });
      transaction.set(reference, document);
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'settings.commerce.payments.update',
        entityType: 'commerceSettings',
        entityId: 'payments',
        requestId: actor.requestId,
        changedFields: ['pod', 'manualTransfer', 'financialDocuments'],
      });
      return document;
    });
  }
}

export function createCommercePaymentSettingsService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreCommercePaymentSettingsService(firestore);
}
