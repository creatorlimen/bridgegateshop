import { z } from 'zod';

import {
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const integrityHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const providerReferenceSchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9.=-]+$/);

export const paymentAttemptDocumentSchema = mutableRecordFieldsSchema.extend({
  orderId: firestoreDocumentIdSchema,
  orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
  method: z.literal('paystack'),
  provider: z.literal('paystack'),
  intendedAmountKobo: moneySchema,
  currency: z.literal('NGN'),
  attemptType: z.enum(['full', 'deposit', 'balance']),
  idempotencyKey: z.string().min(16).max(160),
  requestHash: integrityHashSchema,
  providerReference: providerReferenceSchema,
  initialisationState: z.enum([
    'pending',
    'initialised',
    'failed',
    'expired',
  ]),
  authorizationUrl: z.string().url().nullable(),
  accessCode: z.string().min(1).max(200).nullable(),
  redirectExpiresAt: firestoreTimestampSchema,
  providerInitialisedAt: firestoreTimestampSchema.nullable(),
  failureCode: z.string().max(120).nullable(),
  safeProviderMessage: z.string().max(500).nullable(),
});

export const paymentDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    orderId: firestoreDocumentIdSchema,
    paymentAttemptId: firestoreDocumentIdSchema,
    method: z.literal('paystack'),
    provider: z.literal('paystack'),
    providerReference: providerReferenceSchema,
    amountKobo: moneySchema,
    currency: z.literal('NGN'),
    state: z.enum(['pending', 'succeeded', 'failed', 'reversed']),
    providerPaidAt: firestoreTimestampSchema.nullable(),
    verifiedAt: firestoreTimestampSchema,
    verificationSource: z.enum(['webhook', 'reconciliation', 'manual']),
    safeResponseHash: integrityHashSchema,
    channel: z.string().min(1).max(80).nullable(),
    providerTransactionId: z.string().min(1).max(40),
    deduplicationKey: z.string().min(8).max(200),
    createdAt: firestoreTimestampSchema,
  })
  .strict();

export const providerWebhookEventDocumentSchema = mutableRecordFieldsSchema.extend({
  provider: z.literal('paystack'),
  eventType: z.string().min(1).max(120),
  providerReference: providerReferenceSchema.nullable(),
  signatureVerified: z.literal(true),
  payloadHash: integrityHashSchema,
  processingState: z.enum(['received', 'processed', 'ignored', 'exception']),
  attemptCount: z.number().int().min(1).max(100),
  paymentAttemptId: firestoreDocumentIdSchema.nullable(),
  orderId: firestoreDocumentIdSchema.nullable(),
  errorCode: z.string().max(120).nullable(),
  safeMetadata: z
    .object({
      transactionId: z.string().max(40).nullable(),
      amountKobo: moneySchema.nullable(),
      currency: z.string().max(8).nullable(),
      status: z.string().max(40).nullable(),
    })
    .strict(),
  receivedAt: firestoreTimestampSchema,
  processedAt: firestoreTimestampSchema.nullable(),
});

export const paymentExceptionDocumentSchema = mutableRecordFieldsSchema.extend({
  provider: z.literal('paystack'),
  providerReference: providerReferenceSchema,
  orderId: firestoreDocumentIdSchema.nullable(),
  paymentAttemptId: firestoreDocumentIdSchema.nullable(),
  webhookEventId: firestoreDocumentIdSchema,
  reasonCode: z.enum([
    'UNKNOWN_REFERENCE',
    'AMOUNT_MISMATCH',
    'CURRENCY_MISMATCH',
    'REFERENCE_MISMATCH',
    'RESERVATION_EXPIRED',
    'ORDER_STATE_MISMATCH',
    'PROVIDER_VERIFICATION_FAILED',
  ]),
  expectedAmountKobo: moneySchema.nullable(),
  receivedAmountKobo: moneySchema.nullable(),
  state: z.enum(['open', 'resolved']),
  resolution: z.string().max(500).nullable(),
});

export type PaymentAttemptDocument = z.infer<
  typeof paymentAttemptDocumentSchema
>;
export type PaymentDocument = z.infer<typeof paymentDocumentSchema>;
export type ProviderWebhookEventDocument = z.infer<
  typeof providerWebhookEventDocumentSchema
>;
export type PaymentExceptionDocument = z.infer<
  typeof paymentExceptionDocumentSchema
>;

