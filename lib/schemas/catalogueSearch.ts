import { z } from 'zod';

import {
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
} from '@/lib/schemas/common';
import { catalogueSlugSchema } from '@/lib/schemas/catalogue';

export const catalogueSearchDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    type: z.literal('product'),
    productId: firestoreDocumentIdSchema,
    title: z.string().trim().min(1).max(160),
    slug: catalogueSlugSchema,
    excerpt: z.string().trim().min(1).max(320),
    categoryId: firestoreDocumentIdSchema,
    imageMediaId: firestoreDocumentIdSchema,
    minimumPriceKobo: z.number().int().nonnegative(),
    maximumPriceKobo: z.number().int().nonnegative(),
    currency: z.literal('NGN'),
    stockState: z.enum([
      'inStock',
      'lowStock',
      'outOfStock',
      'notManaged',
    ]),
    exactTokens: z.array(z.string().min(1).max(60)).max(80),
    searchTokens: z.array(z.string().min(1).max(60)).max(240),
    updatedAt: firestoreTimestampSchema,
  })
  .strict();

export type CatalogueSearchDocument = z.infer<
  typeof catalogueSearchDocumentSchema
>;

export type CatalogueSearchRecord = CatalogueSearchDocument & {
  id: string;
};
