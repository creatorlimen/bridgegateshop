import { z } from 'zod';

import {
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
} from '@/lib/schemas/common';

const payloadValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const outboxEventDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    eventName: z.string().min(1).max(160),
    aggregateType: z.string().min(1).max(80),
    aggregateId: firestoreDocumentIdSchema,
    payload: z.record(z.string(), payloadValueSchema),
    state: z.enum(['pending', 'processing', 'processed', 'deadLetter']),
    attemptCount: z.number().int().nonnegative().max(100),
    nextAttemptAt: firestoreTimestampSchema,
    leaseExpiresAt: firestoreTimestampSchema.nullable(),
    lastSafeError: z.string().max(240).nullable().optional(),
    createdAt: firestoreTimestampSchema,
    processedAt: firestoreTimestampSchema.nullable().optional(),
  })
  .strict();

export const fulfilmentOutboxPayloadSchema = z
  .object({
    orderId: firestoreDocumentIdSchema,
    orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
    deliveryEventId: firestoreDocumentIdSchema,
    fulfilmentStatus: z.string().min(1).max(80),
    transitionType: z.enum(['forward', 'reverted']),
  })
  .passthrough();

export type OutboxEventDocument = z.infer<typeof outboxEventDocumentSchema>;
