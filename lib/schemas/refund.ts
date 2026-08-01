import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';

const moneySchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const refundStateSchema = z.enum([
  'requested',
  'approved',
  'processing',
  'processed',
  'failed',
  'rejected',
  'cancelled',
]);

export const refundDocumentSchema = mutableRecordFieldsSchema.extend({
  orderId: firestoreDocumentIdSchema,
  orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
  paymentId: firestoreDocumentIdSchema,
  amountKobo: moneySchema,
  currency: z.literal('NGN'),
  reason: z.string().trim().min(3).max(500),
  state: refundStateSchema,
  requestedBy: actorReferenceSchema,
  requestedAt: firestoreTimestampSchema,
  approvedBy: actorReferenceSchema.nullable(),
  approvedAt: firestoreTimestampSchema.nullable(),
  processedAt: firestoreTimestampSchema.nullable(),
  provider: z.enum(['paystack', 'manual']),
  providerRefundId: z.string().min(1).max(120).nullable(),
  providerTransactionReference: z.string().min(1).max(120),
  providerState: z.string().max(80).nullable(),
  failureCode: z.string().max(120).nullable(),
  resolutionNote: z.string().max(500).nullable(),
  stockDecision: z.enum(['notRestocked', 'acceptedReturnRestocked']),
  idempotencyKey: z.string().min(16).max(160),
});

export const requestRefundInputSchema = z.object({
  orderId: firestoreDocumentIdSchema,
  paymentId: firestoreDocumentIdSchema,
  amountKobo: moneySchema,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export type RefundDocument = z.infer<typeof refundDocumentSchema>;
export type RefundRecord = RefundDocument & { id: string };
