import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';
import { checkoutPaymentMethodSchema } from '@/lib/schemas/checkout';

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const integrityHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const orderStatusSchema = z.enum([
  'pending',
  'awaitingPayment',
  'confirmed',
  'processing',
  'completed',
  'cancelled',
  'failed',
]);

export const orderPaymentStatusSchema = z.enum([
  'unpaid',
  'pending',
  'partiallyPaid',
  'paid',
  'failed',
  'partiallyRefunded',
  'refunded',
]);

export const fulfilmentStatusSchema = z.enum([
  'unfulfilled',
  'preparing',
  'readyForPickup',
  'dispatched',
  'outForDelivery',
  'delivered',
  'collected',
  'cancelled',
]);

const customerSnapshotSchema = z
  .object({
    fullName: z.string().min(2).max(160),
    email: z.string().email().max(320),
    phone: z.string().regex(/^\+234[789][01]\d{8}$/),
    company: z.string().max(160).nullable(),
  })
  .strict();

const deliveryAddressSnapshotSchema = z
  .object({
    recipientName: z.string().min(2).max(160),
    phone: z.string().regex(/^\+234[789][01]\d{8}$/),
    line1: z.string().min(3).max(200),
    line2: z.string().max(200).nullable(),
    landmark: z.string().max(200).nullable(),
    city: z.string().min(2).max(100),
    state: z.literal('Lagos'),
  })
  .strict();

const fulfilmentSnapshotSchema = z
  .object({
    method: z.enum(['delivery', 'pickup']),
    address: deliveryAddressSnapshotSchema.nullable(),
    zoneId: firestoreDocumentIdSchema.nullable(),
    zoneName: z.string().min(1).max(120).nullable(),
    feeKobo: moneySchema,
    estimateLabel: z.string().min(1).max(240),
    pickupLabel: z.string().min(1).max(160).nullable(),
    pickupAddress: z.string().min(1).max(500).nullable(),
    pickupOpeningHours: z.string().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((fulfilment, refinementContext) => {
    const isDelivery = fulfilment.method === 'delivery';
    const hasDelivery =
      fulfilment.address !== null &&
      fulfilment.zoneId !== null &&
      fulfilment.zoneName !== null;
    const hasPickup =
      fulfilment.pickupLabel !== null &&
      fulfilment.pickupAddress !== null &&
      fulfilment.pickupOpeningHours !== null;

    if (isDelivery !== hasDelivery || isDelivery === hasPickup) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fulfilment snapshot fields do not match the selected method.',
        path: ['method'],
      });
    }

    if (!isDelivery && fulfilment.feeKobo !== 0) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Store pickup cannot include a delivery fee.',
        path: ['feeKobo'],
      });
    }
  });

const orderTotalsSchema = z
  .object({
    subtotalKobo: moneySchema,
    discountKobo: moneySchema,
    deliveryKobo: moneySchema,
    taxKobo: moneySchema,
    grandTotalKobo: moneySchema,
    amountPaidKobo: moneySchema,
    amountOutstandingKobo: moneySchema,
  })
  .strict()
  .superRefine((totals, refinementContext) => {
    const expectedGrandTotal =
      totals.subtotalKobo -
      totals.discountKobo +
      totals.deliveryKobo +
      totals.taxKobo;

    if (
      expectedGrandTotal !== totals.grandTotalKobo ||
      totals.amountPaidKobo + totals.amountOutstandingKobo !==
        totals.grandTotalKobo
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Order totals do not reconcile in integer kobo.',
        path: ['grandTotalKobo'],
      });
    }
  });

export const orderDocumentSchema = mutableRecordFieldsSchema
  .extend({
    reference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
    ownerUid: actorReferenceSchema.nullable(),
    guestAccessTokenHash: integrityHashSchema.nullable(),
    source: z.literal('web'),
    currency: z.literal('NGN'),
    cartId: firestoreDocumentIdSchema,
    reservationId: firestoreDocumentIdSchema,
    customer: customerSnapshotSchema,
    fulfilment: fulfilmentSnapshotSchema,
    totals: orderTotalsSchema,
    paymentSelection: z
      .object({
        method: checkoutPaymentMethodSchema,
        payableNowKobo: moneySchema,
        depositKobo: moneySchema,
        outstandingAfterInitialPaymentKobo: moneySchema,
      })
      .strict(),
    policyEvidence: z
      .object({
        termsPolicyId: z.string().min(1).max(120),
        termsVersion: z.string().min(1).max(120),
        privacyPolicyId: z.string().min(1).max(120),
        privacyVersion: z.string().min(1).max(120),
        acceptedAt: firestoreTimestampSchema,
      })
      .strict(),
    customerNote: z.string().max(1_000).nullable(),
    orderStatus: orderStatusSchema,
    paymentStatus: orderPaymentStatusSchema,
    fulfilmentStatus: fulfilmentStatusSchema,
    cancellationSummary: z
      .object({
        reason: z.string().min(3).max(500),
        actorId: actorReferenceSchema,
        cancelledAt: firestoreTimestampSchema,
      })
      .strict()
      .nullable(),
    refundTotalKobo: moneySchema,
    assignedStaffUid: actorReferenceSchema.nullable(),
    internalNoteCount: z.number().int().nonnegative(),
    checkoutIdempotencyKey: z.string().min(16).max(160),
    checkoutRequestHash: integrityHashSchema,
    placedAt: firestoreTimestampSchema,
    confirmedAt: firestoreTimestampSchema.nullable(),
    completedAt: firestoreTimestampSchema.nullable(),
    cancelledAt: firestoreTimestampSchema.nullable(),
  })
  .superRefine((order, refinementContext) => {
    const ownerCount =
      Number(order.ownerUid !== null) +
      Number(order.guestAccessTokenHash !== null);

    if (ownerCount !== 1) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An order must have exactly one customer or guest owner.',
        path: ['ownerUid'],
      });
    }

    if (order.fulfilment.feeKobo !== order.totals.deliveryKobo) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fulfilment and total delivery fees must match.',
        path: ['totals', 'deliveryKobo'],
      });
    }

    if (
      order.paymentSelection.payableNowKobo +
        order.paymentSelection.outstandingAfterInitialPaymentKobo !==
      order.totals.grandTotalKobo
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Payment selection does not reconcile with the order total.',
        path: ['paymentSelection'],
      });
    }
  });

export const orderItemDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    orderId: firestoreDocumentIdSchema,
    productId: firestoreDocumentIdSchema,
    variantId: firestoreDocumentIdSchema,
    productSlug: z.string().min(1).max(180),
    productName: z.string().min(1).max(160),
    variantName: z.string().min(1).max(120),
    packageLabel: z.string().min(1).max(120),
    sku: z.string().min(2).max(80),
    quantity: z.number().int().min(1).max(100),
    unitPriceKobo: moneySchema,
    lineTotalKobo: moneySchema,
    currency: z.literal('NGN'),
    taxTreatment: z.literal('notConfigured'),
    capturedAt: firestoreTimestampSchema,
  })
  .strict()
  .refine(
    (item) => item.lineTotalKobo === item.unitPriceKobo * item.quantity,
    { message: 'Order item total must equal unit price times quantity.' },
  );

export const orderEventDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    orderId: firestoreDocumentIdSchema,
    eventType: z.enum([
      'order.placed',
      'payment.initialised',
      'payment.expired',
      'payment.confirmed',
      'payment.exception',
      'order.cancelled',
      'fulfilment.updated',
    ]),
    previousOrderStatus: orderStatusSchema.nullable(),
    nextOrderStatus: orderStatusSchema,
    previousPaymentStatus: orderPaymentStatusSchema.nullable(),
    nextPaymentStatus: orderPaymentStatusSchema,
    customerLabel: z.string().min(1).max(160),
    customerNote: z.string().max(500).nullable(),
    actorId: actorReferenceSchema,
    idempotencyKey: z.string().min(8).max(200),
    occurredAt: firestoreTimestampSchema,
  })
  .strict();

export type OrderDocument = z.infer<typeof orderDocumentSchema>;
export type OrderItemDocument = z.infer<typeof orderItemDocumentSchema>;
export type OrderEventDocument = z.infer<typeof orderEventDocumentSchema>;
export type OrderRecord = OrderDocument & { id: string };

