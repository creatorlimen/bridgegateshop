import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { withoutDocumentId } from '@/lib/firebase/withoutDocumentId';
import {
  deliveryDocumentSchema,
  deliveryEventDocumentSchema,
  deliveryExceptionDocumentSchema,
} from '@/lib/schemas/fulfilment';
import {
  fulfilmentStatusSchema,
  orderDocumentSchema,
  orderEventDocumentSchema,
} from '@/lib/schemas/order';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { writeOutboxEvent } from '@/lib/services/outbox/writeOutboxEvent';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

type DeliveryActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

const transitionInputSchema = z.object({
  deliveryId: z.string().min(1).max(128),
  nextStatus: fulfilmentStatusSchema.exclude(['cancelled']),
  expectedDeliveryVersion: z.number().int().positive(),
  expectedOrderVersion: z.number().int().positive(),
  customerNote: z.string().trim().min(3).max(500).nullable(),
  internalNote: z.string().trim().min(3).max(1_000).nullable(),
  courierName: z.string().trim().min(2).max(160).nullable(),
  trackingReference: z.string().trim().min(4).max(120).nullable(),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

const revertInputSchema = transitionInputSchema.extend({
  reason: z.string().trim().min(3).max(1_000),
});

const statusPresentation = {
  preparing: {
    label: 'Being Prepared',
    note: 'Your order is being prepared for fulfilment.',
  },
  readyForPickup: {
    label: 'Ready for Pickup',
    note: 'Your order is ready for collection during the approved pickup hours.',
  },
  dispatched: {
    label: 'Dispatched',
    note: 'Your order has been dispatched for delivery.',
  },
  outForDelivery: {
    label: 'Out for Delivery',
    note: 'Your order is out for delivery.',
  },
  delivered: {
    label: 'Delivered',
    note: 'Your order has been marked as delivered.',
  },
  collected: {
    label: 'Collected',
    note: 'Your pickup order has been marked as collected.',
  },
} as const;

const deliveryForwardTransitions = {
  unfulfilled: ['preparing'],
  preparing: ['dispatched'],
  dispatched: ['outForDelivery'],
  outForDelivery: ['delivered'],
  delivered: [],
  readyForPickup: [],
  collected: [],
  cancelled: [],
} as const;

const pickupForwardTransitions = {
  unfulfilled: ['preparing'],
  preparing: ['readyForPickup'],
  readyForPickup: ['collected'],
  dispatched: [],
  outForDelivery: [],
  delivered: [],
  collected: [],
  cancelled: [],
} as const;

const deliveryPreviousStatus = {
  preparing: 'unfulfilled',
  dispatched: 'preparing',
  outForDelivery: 'dispatched',
  delivered: 'outForDelivery',
} as const;

const pickupPreviousStatus = {
  preparing: 'unfulfilled',
  readyForPickup: 'preparing',
  collected: 'readyForPickup',
} as const;

export class DeliveryTransitionError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryTransitionError';
  }
}

function parseDelivery(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = deliveryDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new DeliveryTransitionError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      'Delivery data is invalid.',
    );
  }
  return { id: snapshot.id, ...parsed.data };
}

function parseOrder(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsed = orderDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new DeliveryTransitionError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      'Order data is invalid.',
    );
  }
  return { id: snapshot.id, ...parsed.data };
}

class FirestoreDeliveryTransitionService {
  constructor(private readonly firestore: Firestore) {}

  transition(
    unparsedInput: z.input<typeof transitionInputSchema>,
    actor: DeliveryActor,
  ) {
    const input = transitionInputSchema.parse(unparsedInput);
    return this.applyTransition(input, 'forward', actor);
  }

  revert(
    unparsedInput: z.input<typeof revertInputSchema>,
    actor: DeliveryActor,
  ) {
    const input = revertInputSchema.parse(unparsedInput);
    return this.applyTransition(
      { ...input, internalNote: input.reason },
      'reverted',
      actor,
    );
  }

  private async applyTransition(
    input: z.infer<typeof transitionInputSchema>,
    transitionType: 'forward' | 'reverted',
    actor: DeliveryActor,
  ) {
    const deliveryReference = this.firestore
      .collection(firestoreCollections.deliveries)
      .doc(input.deliveryId);
    const eventId = createDeterministicId(
      'delivery-event',
      `${input.deliveryId}:${transitionType}:${input.idempotencyKey}`,
    );
    const eventReference = deliveryReference
      .collection(firestoreCollections.deliveryEvents)
      .doc(eventId);

    return this.firestore.runTransaction(async (transaction) => {
      const [deliverySnapshot, eventSnapshot] = await transaction.getAll(
        deliveryReference,
        eventReference,
      );
      const delivery = parseDelivery(deliverySnapshot);
      const orderReference = this.firestore
        .collection(firestoreCollections.orders)
        .doc(delivery.orderId);
      const order = parseOrder(await transaction.get(orderReference));
      if (eventSnapshot.exists) {
        return { delivery, order, deliveryEventId: eventId, replay: true };
      }
      if (
        delivery.version !== input.expectedDeliveryVersion ||
        order.version !== input.expectedOrderVersion
      ) {
        throw new DeliveryTransitionError(
          'CONFLICT',
          'The order or delivery changed before this transition.',
        );
      }
      if (
        !['confirmed', 'processing', 'completed'].includes(order.orderStatus) ||
        ['cancelled', 'failed'].includes(order.orderStatus) ||
        delivery.status !== order.fulfilmentStatus ||
        delivery.method !== order.fulfilment.method
      ) {
        throw new DeliveryTransitionError(
          'INVALID_STATE',
          'This order is not eligible for a fulfilment transition.',
        );
      }
      if (transitionType === 'forward') {
        const transitions =
          delivery.method === 'delivery'
            ? deliveryForwardTransitions
            : pickupForwardTransitions;
        if (!(transitions[delivery.status] as readonly string[]).includes(input.nextStatus)) {
          throw new DeliveryTransitionError(
            'INVALID_STATE',
            'The requested fulfilment transition is not allowed.',
          );
        }
      } else {
        const previousStatus =
          delivery.method === 'delivery'
            ? deliveryPreviousStatus[
                delivery.status as keyof typeof deliveryPreviousStatus
              ]
            : pickupPreviousStatus[
                delivery.status as keyof typeof pickupPreviousStatus
              ];
        if (!previousStatus || previousStatus !== input.nextStatus) {
          throw new DeliveryTransitionError(
            'INVALID_STATE',
            'A status can only be reverted by one valid step.',
          );
        }
      }
      if (input.nextStatus === 'dispatched' && !input.trackingReference) {
        throw new DeliveryTransitionError(
          'INVALID_STATE',
          'A dispatch tracking reference is required.',
        );
      }

      const now = Timestamp.now();
      const reachesFulfilment = ['delivered', 'collected'].includes(input.nextStatus);
      const canCompleteOrder =
        reachesFulfilment && order.totals.amountOutstandingKobo === 0;
      const nextOrderStatus =
        transitionType === 'reverted'
          ? input.nextStatus === 'unfulfilled'
            ? 'confirmed'
            : 'processing'
          : canCompleteOrder
            ? 'completed'
            : input.nextStatus === 'preparing' || reachesFulfilment
              ? 'processing'
              : order.orderStatus;
      const presentation = statusPresentation[
        input.nextStatus as keyof typeof statusPresentation
      ] ?? {
        label: 'Confirmed',
        note: 'Your fulfilment status was updated.',
      };
      const exceptionFlags = new Set(delivery.exceptionFlags);
      if (transitionType === 'reverted') exceptionFlags.add('revertedStatus');
      const nextDeliveryDocument = deliveryDocumentSchema.parse({
        ...withoutDocumentId(delivery),
        status: input.nextStatus,
        assignedStaffUid: actor.actorId,
        courierName: input.courierName ?? delivery.courierName,
        trackingReference:
          input.trackingReference ?? delivery.trackingReference,
        dispatchedAt:
          input.nextStatus === 'dispatched' ? now : delivery.dispatchedAt,
        outForDeliveryAt:
          input.nextStatus === 'outForDelivery'
            ? now
            : delivery.outForDeliveryAt,
        fulfilledAt: reachesFulfilment ? now : null,
        exceptionFlags: [...exceptionFlags],
        latestCustomerEventAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: delivery.version + 1,
      });
      const nextOrderDocument = orderDocumentSchema.parse({
        ...order,
        orderStatus: nextOrderStatus,
        fulfilmentStatus: input.nextStatus,
        assignedStaffUid: actor.actorId,
        internalNoteCount:
          order.internalNoteCount + Number(input.internalNote !== null),
        completedAt: canCompleteOrder ? now : null,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: order.version + 1,
      });
      const customerNote = input.customerNote ?? presentation.note;

      transaction.set(deliveryReference, nextDeliveryDocument);
      transaction.set(orderReference, nextOrderDocument);
      transaction.create(
        eventReference,
        deliveryEventDocumentSchema.parse({
          schemaVersion: 1,
          deliveryId: delivery.id,
          orderId: order.id,
          eventType: 'fulfilment.updated',
          transitionType,
          previousStatus: delivery.status,
          nextStatus: input.nextStatus,
          customerLabel: presentation.label,
          customerNote,
          internalNote: input.internalNote,
          actorId: actor.actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        }),
      );
      transaction.create(
        orderReference
          .collection(firestoreCollections.orderEvents)
          .doc(createDeterministicId('event', `${eventId}:order`)),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId: order.id,
          eventType: 'fulfilment.updated',
          previousOrderStatus: order.orderStatus,
          nextOrderStatus,
          previousPaymentStatus: order.paymentStatus,
          nextPaymentStatus: order.paymentStatus,
          customerLabel: presentation.label,
          customerNote,
          actorId: actor.actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        }),
      );
      writeOutboxEvent(transaction, this.firestore, {
        eventName: 'fulfilment.updated',
        aggregateType: 'delivery',
        aggregateId: delivery.id,
        idempotencyKey: `fulfilment-updated:${eventId}`,
        payload: {
          orderId: order.id,
          orderReference: order.reference,
          deliveryEventId: eventId,
          fulfilmentStatus: input.nextStatus,
          transitionType,
        },
        now,
      });
      if (transitionType === 'reverted') {
        const exceptionId = createDeterministicId(
          'delivery-exception',
          `${eventId}:reverted-status`,
        );
        transaction.create(
          this.firestore
            .collection(firestoreCollections.deliveryExceptions)
            .doc(exceptionId),
          deliveryExceptionDocumentSchema.parse({
            schemaVersion: 1,
            deliveryId: delivery.id,
            orderId: order.id,
            orderReference: order.reference,
            type: 'revertedStatus',
            state: 'open',
            reason: input.internalNote,
            sourceEventId: eventId,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: now,
            createdBy: actor.actorId,
            updatedAt: now,
            updatedBy: actor.actorId,
            version: 1,
          }),
        );
      }
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action:
          transitionType === 'reverted'
            ? 'delivery.status.revert'
            : 'delivery.status.update',
        entityType: 'delivery',
        entityId: delivery.id,
        publicReference: order.reference,
        requestId: actor.requestId,
        changedFields: ['status', 'orderStatus', 'fulfilmentStatus'],
        reason: input.internalNote,
      });
      return {
        delivery: { id: delivery.id, ...nextDeliveryDocument },
        order: { id: order.id, ...nextOrderDocument },
        deliveryEventId: eventId,
        replay: false,
      };
    });
  }
}

export function createDeliveryTransitionService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreDeliveryTransitionService(firestore);
}


