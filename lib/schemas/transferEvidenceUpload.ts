import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
} from '@/lib/schemas/common';

export const createTransferEvidenceIntentInputSchema = z.object({
  orderId: firestoreDocumentIdSchema,
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  bytes: z.number().int().positive().max(5 * 1_024 * 1_024),
});

export const finaliseTransferEvidenceInputSchema = z.object({
  uploadIntentId: firestoreDocumentIdSchema,
});

export const transferEvidenceUploadIntentDocumentSchema = z.object({
  schemaVersion: z.number().int().positive(),
  purpose: z.literal('manualTransferEvidence'),
  orderId: firestoreDocumentIdSchema,
  ownerUid: actorReferenceSchema.nullable(),
  guestAccessTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  originalFileName: z.string().min(1).max(180),
  declaredMimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  declaredBytes: z.number().int().positive().max(5 * 1_024 * 1_024),
  stagingStorageObjectPath: z.string().min(10).max(500),
  status: z.enum(['pending', 'finalised', 'failed']),
  createdAt: firestoreTimestampSchema,
  expiresAt: firestoreTimestampSchema,
  finalisedAt: firestoreTimestampSchema.nullable(),
  evidenceId: firestoreDocumentIdSchema.nullable(),
  safeFailureCode: z.string().max(120).nullable(),
});

export type CreateTransferEvidenceIntentInput = z.infer<typeof createTransferEvidenceIntentInputSchema>;
export type FinaliseTransferEvidenceInput = z.infer<typeof finaliseTransferEvidenceInputSchema>;
