import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
} from '@/lib/schemas/common';

export const catalogueSlugClaimDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    ownerType: z.enum(['category', 'product']),
    ownerId: firestoreDocumentIdSchema,
    claimedAt: firestoreTimestampSchema,
    claimedBy: actorReferenceSchema,
  })
  .strict();

export const catalogueSkuClaimDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    ownerId: firestoreDocumentIdSchema,
    claimedAt: firestoreTimestampSchema,
    claimedBy: actorReferenceSchema,
  })
  .strict();

export type CatalogueSlugClaimDocument = z.infer<
  typeof catalogueSlugClaimDocumentSchema
>;
export type CatalogueSkuClaimDocument = z.infer<
  typeof catalogueSkuClaimDocumentSchema
>;
