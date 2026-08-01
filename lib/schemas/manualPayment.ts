import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';

export const externalPaymentReferenceSchema = z
  .string()
  .trim()
  .min(4)
  .max(100)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .transform((value) => value.toUpperCase());

export const manualPaymentInputSchema = z.object({
  orderId: firestoreDocumentIdSchema,
  amountKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  externalReference: externalPaymentReferenceSchema,
  transactionDate: z.coerce.date(),
  note: z.string().trim().max(500).nullable(),
  evidenceId: firestoreDocumentIdSchema.nullable(),
  expectedOrderVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export const transferInstructionDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  orderId: firestoreDocumentIdSchema,
  settingsVersion: z.string().min(1).max(120),
  bankName: z.string().min(2).max(160),
  accountName: z.string().min(2).max(160),
  accountNumber: z.string().regex(/^\d{10}$/),
  customerMessage: z.string().min(3).max(500),
  createdAt: firestoreTimestampSchema,
});

export const transferEvidenceDocumentSchema = mutableRecordFieldsSchema.extend({
  orderId: firestoreDocumentIdSchema,
  ownerUid: actorReferenceSchema.nullable(),
  guestAccessTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  storageObjectPath: z.string().min(10).max(500),
  originalFileName: z.string().min(1).max(180),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  bytes: z.number().int().positive().max(5 * 1_024 * 1_024),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal('submitted'),
  submittedAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema,
});

export type ManualPaymentInput = z.infer<typeof manualPaymentInputSchema>;
export type TransferInstructionDocument = z.infer<typeof transferInstructionDocumentSchema>;
export type TransferEvidenceDocument = z.infer<typeof transferEvidenceDocumentSchema>;
