import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { withoutDocumentId } from '@/lib/firebase/withoutDocumentId';
import {
  deliveryDocumentSchema,
  deliveryExceptionDocumentSchema,
  deliveryExceptionTypeSchema,
} from '@/lib/schemas/fulfilment';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { writeOutboxEvent } from '@/lib/services/outbox/writeOutboxEvent';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

type DeliveryExceptionActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

const reportInputSchema = z.object({
  deliveryId: z.string().min(1).max(128),
  type: deliveryExceptionTypeSchema,
  reason: z.string().trim().min(3).max(1_000),
  sourceEventId: z.string().min(1).max(128).nullable(),
  expectedDeliveryVersion: z.number().int().positive().nullable(),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

const resolveInputSchema = z.object({
  exceptionId: z.string().min(1).max(128),
  expectedExceptionVersion: z.number().int().positive(),
  resolutionNote: z.string().trim().min(3).max(1_000),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export class DeliveryExceptionError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryExceptionError';
  }
}

function parseDelivery(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = deliveryDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new DeliveryExceptionError('NOT_FOUND', 'Delivery data is invalid.');
  }
  return { id: snapshot.id, ...parsed.data };
}

class FirestoreDeliveryExceptionService {
  constructor(private readonly firestore: Firestore) {}

  async report(
    unparsedInput: z.input<typeof reportInputSchema>,
    actor: DeliveryExceptionActor,
  ) {
    const input = reportInputSchema.parse(unparsedInput);
    const deliveryReference = this.firestore
      .collection(firestoreCollections.deliveries)
      .doc(input.deliveryId);
    const exceptionId = createDeterministicId(
      'delivery-exception',
      `${input.deliveryId}:${input.type}`,
    );
    const exceptionReference = this.firestore
      .collection(firestoreCollections.deliveryExceptions)
      .doc(exceptionId);

    return this.firestore.runTransaction(async (transaction) => {
      const [deliverySnapshot, exceptionSnapshot] = await transaction.getAll(
        deliveryReference,
        exceptionReference,
      );
      const delivery = parseDelivery(deliverySnapshot);
      if (
        input.expectedDeliveryVersion !== null &&
        delivery.version !== input.expectedDeliveryVersion
      ) {
        throw new DeliveryExceptionError(
          'CONFLICT',
          'The delivery changed before the exception was reported.',
        );
      }
      const existing = exceptionSnapshot.exists
        ? deliveryExceptionDocumentSchema.safeParse(exceptionSnapshot.data())
        : null;
      if (existing && !existing.success) {
        throw new DeliveryExceptionError(
          'INVALID_STATE',
          'Stored delivery-exception data is invalid.',
        );
      }
      if (existing?.success && existing.data.state === 'open') {
        return {
          exception: { id: exceptionId, ...existing.data },
          delivery,
          replay: true,
        };
      }
      const now = Timestamp.now();
      const nextException = deliveryExceptionDocumentSchema.parse({
        schemaVersion: 1,
        deliveryId: delivery.id,
        orderId: delivery.orderId,
        orderReference: delivery.orderReference,
        type: input.type,
        state: 'open',
        reason: input.reason,
        sourceEventId: input.sourceEventId,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
        createdAt: existing?.success ? existing.data.createdAt : now,
        createdBy: existing?.success ? existing.data.createdBy : actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: existing?.success ? existing.data.version + 1 : 1,
      });
      const flags = new Set(delivery.exceptionFlags);
      flags.add(input.type);
      const nextDelivery = deliveryDocumentSchema.parse({
        ...withoutDocumentId(delivery),
        exceptionFlags: [...flags],
        updatedAt: now,
        updatedBy: actor.actorId,
        version: delivery.version + 1,
      });
      transaction.set(exceptionReference, nextException);
      transaction.set(deliveryReference, nextDelivery);
      writeOutboxEvent(transaction, this.firestore, {
        eventName: 'delivery.exceptionOpened',
        aggregateType: 'delivery',
        aggregateId: delivery.id,
        idempotencyKey: `delivery-exception-open:${exceptionId}:${nextException.version}`,
        payload: {
          orderId: delivery.orderId,
          orderReference: delivery.orderReference,
          exceptionId,
          exceptionType: input.type,
        },
        now,
      });
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'delivery.exception.open',
        entityType: 'deliveryException',
        entityId: exceptionId,
        publicReference: delivery.orderReference,
        requestId: actor.requestId,
        changedFields: ['state', 'exceptionFlags'],
        reason: input.reason,
      });
      return {
        exception: { id: exceptionId, ...nextException },
        delivery: { id: delivery.id, ...nextDelivery },
        replay: false,
      };
    });
  }

  async resolve(
    unparsedInput: z.input<typeof resolveInputSchema>,
    actor: DeliveryExceptionActor,
  ) {
    const input = resolveInputSchema.parse(unparsedInput);
    const exceptionReference = this.firestore
      .collection(firestoreCollections.deliveryExceptions)
      .doc(input.exceptionId);
    return this.firestore.runTransaction(async (transaction) => {
      const exceptionSnapshot = await transaction.get(exceptionReference);
      const parsed = deliveryExceptionDocumentSchema.safeParse(
        exceptionSnapshot.data(),
      );
      if (!exceptionSnapshot.exists || !parsed.success) {
        throw new DeliveryExceptionError('NOT_FOUND', 'Delivery exception was not found.');
      }
      const exception = { id: exceptionSnapshot.id, ...parsed.data };
      const deliveryReference = this.firestore
        .collection(firestoreCollections.deliveries)
        .doc(exception.deliveryId);
      const delivery = parseDelivery(await transaction.get(deliveryReference));
      if (exception.state === 'resolved') {
        return { exception, delivery, replay: true };
      }
      if (exception.version !== input.expectedExceptionVersion) {
        throw new DeliveryExceptionError(
          'CONFLICT',
          'The exception changed before resolution.',
        );
      }
      const now = Timestamp.now();
      const nextException = deliveryExceptionDocumentSchema.parse({
        ...withoutDocumentId(exception),
        state: 'resolved',
        resolvedAt: now,
        resolvedBy: actor.actorId,
        resolutionNote: input.resolutionNote,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: exception.version + 1,
      });
      const nextDelivery = deliveryDocumentSchema.parse({
        ...withoutDocumentId(delivery),
        exceptionFlags: delivery.exceptionFlags.filter(
          (flag) => flag !== exception.type,
        ),
        updatedAt: now,
        updatedBy: actor.actorId,
        version: delivery.version + 1,
      });
      transaction.set(exceptionReference, nextException);
      transaction.set(deliveryReference, nextDelivery);
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'delivery.exception.resolve',
        entityType: 'deliveryException',
        entityId: exception.id,
        publicReference: delivery.orderReference,
        requestId: actor.requestId,
        changedFields: ['state', 'exceptionFlags'],
        reason: input.resolutionNote,
      });
      return {
        exception: { id: exception.id, ...nextException },
        delivery: { id: delivery.id, ...nextDelivery },
        replay: false,
      };
    });
  }
}

export function createDeliveryExceptionService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreDeliveryExceptionService(firestore);
}

