import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';
import { fulfilmentStatusSchema } from '@/lib/schemas/order';

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const serviceDaySchema = z.number().int().min(0).max(6);
const integrityHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const deliveryZoneDocumentSchema = mutableRecordFieldsSchema
  .extend({
    name: z.string().trim().min(2).max(120),
    active: z.boolean(),
    areaHints: z.array(z.string().trim().min(2).max(120)).max(100),
    postcodeHints: z.array(z.string().trim().min(2).max(20)).max(100),
    feeKobo: moneySchema,
    serviceDays: z.array(serviceDaySchema).min(1).max(7),
    sameDayEnabled: z.boolean(),
    cutoffLocalTime: localTimeSchema,
    minimumBusinessDays: z.number().int().min(0).max(30),
    maximumBusinessDays: z.number().int().min(0).max(30),
    podEligible: z.boolean(),
    deliveryEnabled: z.boolean(),
    displayCopy: z.string().trim().min(3).max(500),
    priority: z.number().int().min(0).max(1_000),
  })
  .strict()
  .superRefine((zone, context) => {
    if (new Set(zone.serviceDays).size !== zone.serviceDays.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Delivery-zone service days must be unique.',
        path: ['serviceDays'],
      });
    }
    if (zone.maximumBusinessDays < zone.minimumBusinessDays) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The maximum delivery window cannot be below the minimum.',
        path: ['maximumBusinessDays'],
      });
    }
  });

export const businessCalendarDocumentSchema = mutableRecordFieldsSchema
  .extend({
    date: localDateSchema,
    name: z.string().trim().min(2).max(160),
    open: z.boolean(),
    affectedZoneIds: z.array(firestoreDocumentIdSchema).max(50),
    note: z.string().trim().max(500).nullable(),
  })
  .strict();

export const fulfilmentSettingsDocumentSchema = mutableRecordFieldsSchema
  .extend({
    settingsKey: z.literal('fulfilment'),
    configurationVersion: z.string().min(1).max(120),
    pickup: z
      .object({
        enabled: z.boolean(),
        label: z.string().trim().min(2).max(160),
        address: z.string().trim().min(3).max(500),
        openingHours: z.string().trim().min(3).max(500),
        serviceDays: z.array(serviceDaySchema).min(1).max(7),
        cutoffLocalTime: localTimeSchema,
        sameDayEnabled: z.boolean(),
        minimumPreparationBusinessDays: z.number().int().min(0).max(30),
        maximumPreparationBusinessDays: z.number().int().min(0).max(30),
      })
      .strict(),
    supportWhatsappPhone: z.string().regex(/^234[789][01]\d{8}$/).nullable(),
    trackingRateLimit: z
      .object({
        windowMinutes: z.number().int().min(1).max(1_440),
        maximumAttemptsPerIp: z.number().int().min(1).max(100),
        maximumAttemptsPerReference: z.number().int().min(1).max(100),
        maximumAttemptsPerFactor: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((settings, context) => {
    const pickup = settings.pickup;
    if (new Set(pickup.serviceDays).size !== pickup.serviceDays.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pickup service days must be unique.',
        path: ['pickup', 'serviceDays'],
      });
    }
    if (
      pickup.maximumPreparationBusinessDays <
      pickup.minimumPreparationBusinessDays
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The maximum pickup window cannot be below the minimum.',
        path: ['pickup', 'maximumPreparationBusinessDays'],
      });
    }
  });

export const deliveryEstimateSchema = z
  .object({
    configurationVersion: z.string().min(1).max(120),
    calculatedAt: firestoreTimestampSchema,
    localPlacementDate: localDateSchema,
    earliestDate: localDateSchema,
    latestDate: localDateSchema,
    sameDayQualified: z.boolean(),
    label: z.string().min(3).max(240),
    assumptions: z.array(z.string().min(1).max(160)).max(20),
  })
  .strict();

export const deliveryExceptionTypeSchema = z.enum([
  'overdueEstimate',
  'notificationFailed',
  'invalidAddress',
  'revertedStatus',
]);

const zoneSnapshotSchema = z
  .object({
    zoneId: firestoreDocumentIdSchema,
    name: z.string().min(2).max(120),
    feeKobo: moneySchema,
    serviceDays: z.array(serviceDaySchema).min(1).max(7),
    sameDayEnabled: z.boolean(),
    cutoffLocalTime: localTimeSchema,
    minimumBusinessDays: z.number().int().min(0).max(30),
    maximumBusinessDays: z.number().int().min(0).max(30),
  })
  .strict();

const pickupSnapshotSchema = z
  .object({
    label: z.string().min(2).max(160),
    address: z.string().min(3).max(500),
    openingHours: z.string().min(3).max(500),
    serviceDays: z.array(serviceDaySchema).min(1).max(7),
    cutoffLocalTime: localTimeSchema,
    minimumPreparationBusinessDays: z.number().int().min(0).max(30),
    maximumPreparationBusinessDays: z.number().int().min(0).max(30),
  })
  .strict();

export const deliveryDocumentSchema = mutableRecordFieldsSchema
  .extend({
    orderId: firestoreDocumentIdSchema,
    orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
    ownerUid: actorReferenceSchema.nullable(),
    guestAccessTokenHash: integrityHashSchema.nullable(),
    method: z.enum(['delivery', 'pickup']),
    status: fulfilmentStatusSchema,
    configurationVersion: z.string().min(1).max(120),
    zoneSnapshot: zoneSnapshotSchema.nullable(),
    pickupSnapshot: pickupSnapshotSchema.nullable(),
    estimate: deliveryEstimateSchema,
    assignedStaffUid: actorReferenceSchema.nullable(),
    courierName: z.string().trim().max(160).nullable(),
    trackingReference: z.string().trim().max(120).nullable(),
    dispatchedAt: firestoreTimestampSchema.nullable(),
    outForDeliveryAt: firestoreTimestampSchema.nullable(),
    fulfilledAt: firestoreTimestampSchema.nullable(),
    exceptionFlags: z.array(deliveryExceptionTypeSchema).max(4),
    latestCustomerEventAt: firestoreTimestampSchema.nullable(),
  })
  .strict()
  .superRefine((delivery, context) => {
    const deliverySnapshotMatches =
      delivery.method === 'delivery' &&
      delivery.zoneSnapshot !== null &&
      delivery.pickupSnapshot === null;
    const pickupSnapshotMatches =
      delivery.method === 'pickup' &&
      delivery.zoneSnapshot === null &&
      delivery.pickupSnapshot !== null;
    if (!deliverySnapshotMatches && !pickupSnapshotMatches) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Delivery snapshots do not match the fulfilment method.',
        path: ['method'],
      });
    }
    const ownerCount =
      Number(delivery.ownerUid !== null) +
      Number(delivery.guestAccessTokenHash !== null);
    if (ownerCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A delivery must have exactly one customer or guest owner.',
        path: ['ownerUid'],
      });
    }
  });

export const deliveryEventDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    deliveryId: firestoreDocumentIdSchema,
    orderId: firestoreDocumentIdSchema,
    eventType: z.literal('fulfilment.updated'),
    transitionType: z.enum(['forward', 'reverted']),
    previousStatus: fulfilmentStatusSchema,
    nextStatus: fulfilmentStatusSchema,
    customerLabel: z.string().min(1).max(160),
    customerNote: z.string().max(500).nullable(),
    internalNote: z.string().max(1_000).nullable(),
    actorId: actorReferenceSchema,
    idempotencyKey: z.string().min(16).max(160),
    occurredAt: firestoreTimestampSchema,
  })
  .strict();

export const deliveryExceptionDocumentSchema = mutableRecordFieldsSchema
  .extend({
    deliveryId: firestoreDocumentIdSchema,
    orderId: firestoreDocumentIdSchema,
    orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
    type: deliveryExceptionTypeSchema,
    state: z.enum(['open', 'resolved']),
    reason: z.string().trim().min(3).max(1_000),
    sourceEventId: firestoreDocumentIdSchema.nullable(),
    resolvedAt: firestoreTimestampSchema.nullable(),
    resolvedBy: actorReferenceSchema.nullable(),
    resolutionNote: z.string().trim().max(1_000).nullable(),
  })
  .strict();

export type DeliveryZoneDocument = z.infer<typeof deliveryZoneDocumentSchema>;
export type BusinessCalendarDocument = z.infer<typeof businessCalendarDocumentSchema>;
export type FulfilmentSettingsDocument = z.infer<typeof fulfilmentSettingsDocumentSchema>;
export type DeliveryEstimate = z.infer<typeof deliveryEstimateSchema>;
export type DeliveryDocument = z.infer<typeof deliveryDocumentSchema>;
export type DeliveryRecord = DeliveryDocument & { id: string };
export type DeliveryEventDocument = z.infer<typeof deliveryEventDocumentSchema>;
export type DeliveryExceptionDocument = z.infer<typeof deliveryExceptionDocumentSchema>;
