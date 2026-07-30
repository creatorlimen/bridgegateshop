import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
} from '@/lib/schemas/common';

export const allowedCatalogueImageMimeTypes = [
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const createCatalogueUploadIntentInputSchema = z
  .object({
    productId: firestoreDocumentIdSchema,
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum(allowedCatalogueImageMimeTypes),
    bytes: z.number().int().positive().max(8 * 1024 * 1024),
    altText: z.string().trim().min(3).max(300),
  })
  .strict();

export const finaliseCatalogueUploadInputSchema = z
  .object({
    uploadIntentId: firestoreDocumentIdSchema,
  })
  .strict();

export const catalogueUploadIntentDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    purpose: z.literal('catalogueProductMedia'),
    productId: firestoreDocumentIdSchema,
    ownerUid: actorReferenceSchema,
    originalFileName: z.string().trim().min(1).max(240),
    declaredMimeType: z.enum(allowedCatalogueImageMimeTypes),
    declaredBytes: z.number().int().positive().max(8 * 1024 * 1024),
    altText: z.string().trim().min(3).max(300),
    stagingStorageObjectPath: z.string().trim().min(1).max(1_024),
    status: z.enum(['pending', 'finalising', 'finalised', 'failed']),
    createdAt: firestoreTimestampSchema,
    expiresAt: firestoreTimestampSchema,
    finalisedAt: firestoreTimestampSchema.nullable(),
    mediaId: firestoreDocumentIdSchema.nullable(),
    safeFailureCode: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export type CreateCatalogueUploadIntentInput = z.infer<
  typeof createCatalogueUploadIntentInputSchema
>;
export type FinaliseCatalogueUploadInput = z.infer<
  typeof finaliseCatalogueUploadInputSchema
>;
export type CatalogueUploadIntentDocument = z.infer<
  typeof catalogueUploadIntentDocumentSchema
>;
