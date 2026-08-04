import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';

const integrityHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const notificationChannelSchema = z.enum(['email', 'sms']);

export const notificationTemplateDocumentSchema = mutableRecordFieldsSchema
  .extend({
    templateKey: z.string().regex(/^fulfilment\.[A-Za-z]+\.(email|sms)$/),
    eventType: z.literal('fulfilment.updated'),
    fulfilmentStatus: z.enum([
      'preparing',
      'readyForPickup',
      'dispatched',
      'outForDelivery',
      'delivered',
      'collected',
    ]),
    channel: notificationChannelSchema,
    locale: z.literal('en-NG'),
    subjectTemplate: z.string().trim().min(1).max(200).nullable(),
    bodyTemplate: z.string().trim().min(3).max(2_000),
    allowedVariables: z
      .array(z.enum(['customerName', 'orderReference', 'statusLabel', 'trackingUrl']))
      .max(4),
    classification: z.literal('transactional'),
    active: z.boolean(),
    templateVersion: z.string().min(1).max(120),
    approvedAt: firestoreTimestampSchema.nullable(),
    approvedBy: actorReferenceSchema.nullable(),
    providerTemplateId: z.string().max(160).nullable(),
  })
  .strict();

export const notificationSettingsDocumentSchema = mutableRecordFieldsSchema
  .extend({
    settingsKey: z.literal('notifications'),
    configurationVersion: z.string().min(1).max(120),
    email: z
      .object({
        enabled: z.boolean(),
        fromName: z.string().trim().min(2).max(120),
        fromEmail: z.string().email().max(320),
        replyToEmail: z.string().email().max(320).nullable(),
        maximumAttempts: z.number().int().min(1).max(10),
      })
      .strict(),
    sms: z
      .object({
        enabled: z.boolean(),
        senderId: z.string().trim().min(2).max(20),
        enabledStatuses: z.array(
          z.enum([
            'preparing',
            'readyForPickup',
            'dispatched',
            'outForDelivery',
            'delivered',
            'collected',
          ]),
        ),
        maximumAttempts: z.number().int().min(1).max(10),
      })
      .strict(),
  })
  .strict();

export const notificationEventDocumentSchema = mutableRecordFieldsSchema
  .extend({
    businessEvent: z.literal('fulfilment.updated'),
    deliveryEventId: firestoreDocumentIdSchema,
    deliveryId: firestoreDocumentIdSchema,
    orderId: firestoreDocumentIdSchema,
    orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
    channel: notificationChannelSchema,
    templateId: firestoreDocumentIdSchema,
    templateVersion: z.string().min(1).max(120),
    destinationHash: integrityHashSchema,
    destinationReference: z.enum(['order.customer.email', 'order.customer.phone']),
    classification: z.literal('transactional'),
    deduplicationKey: z.string().min(16).max(240),
    state: z.enum(['pending', 'processing', 'sent', 'failed', 'suppressed']),
    attemptCount: z.number().int().nonnegative().max(100),
    nextAttemptAt: firestoreTimestampSchema,
    leaseExpiresAt: firestoreTimestampSchema.nullable(),
    lastSafeError: z.string().max(240).nullable(),
    renderedSubject: z.string().max(200).nullable(),
    renderedBody: z.string().min(1).max(2_000),
    sentAt: firestoreTimestampSchema.nullable(),
  })
  .strict();

export const notificationAttemptDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    notificationEventId: firestoreDocumentIdSchema,
    channel: notificationChannelSchema,
    destinationHash: integrityHashSchema,
    destinationReference: z.enum(['order.customer.email', 'order.customer.phone']),
    provider: z.string().min(2).max(80),
    providerMessageId: z.string().max(160).nullable(),
    state: z.enum(['queued', 'sent', 'delivered', 'failed', 'suppressed', 'retrying']),
    attemptNumber: z.number().int().positive().max(100),
    safeFailureCode: z.string().max(120).nullable(),
    createdAt: firestoreTimestampSchema,
    completedAt: firestoreTimestampSchema.nullable(),
  })
  .strict();

export type NotificationTemplateDocument = z.infer<
  typeof notificationTemplateDocumentSchema
>;
export type NotificationSettingsDocument = z.infer<
  typeof notificationSettingsDocumentSchema
>;
export type NotificationEventDocument = z.infer<
  typeof notificationEventDocumentSchema
>;
export type NotificationAttemptDocument = z.infer<
  typeof notificationAttemptDocumentSchema
>;
