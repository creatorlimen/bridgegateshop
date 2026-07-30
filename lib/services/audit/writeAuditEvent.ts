import 'server-only';

import {
  Timestamp,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import type { Role } from '@/lib/auth/roles';
import { firestoreCollections } from '@/lib/firebase/collections';

type WriteAuditEventInput = {
  actorId: string;
  actorRoleIds: readonly Role[];
  action: string;
  entityType: string;
  entityId: string;
  publicReference?: string | null;
  requestId: string;
  changedFields?: readonly string[];
  reason?: string | null;
};

export function writeAuditEvent(
  transaction: Transaction,
  firestore: Firestore,
  input: WriteAuditEventInput,
) {
  const auditEventReference = firestore
    .collection(firestoreCollections.auditEvents)
    .doc();

  transaction.create(auditEventReference, {
    eventId: auditEventReference.id,
    schemaVersion: 1,
    occurredAt: Timestamp.now(),
    actorType: 'staff',
    actorId: input.actorId,
    actorRoleSnapshot: [...input.actorRoleIds],
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    publicReference: input.publicReference ?? null,
    requestId: input.requestId,
    changedFields: [...(input.changedFields ?? [])],
    reason: input.reason ?? null,
    changeReference: null,
    origin: 'administration',
    result: 'success',
  });
}
