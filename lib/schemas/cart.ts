import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';

export const cartDocumentSchema = mutableRecordFieldsSchema
  .extend({
    ownerUid: actorReferenceSchema.nullable(),
    guestTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    status: z.enum([
      'active',
      'converted',
      'abandoned',
      'expired',
      'merged',
    ]),
    currency: z.literal('NGN'),
    expiresAt: firestoreTimestampSchema,
    lastPricedAt: firestoreTimestampSchema.nullable(),
    mergedIntoCartId: firestoreDocumentIdSchema.nullable(),
    mergeNotices: z
      .array(
        z
          .object({
            variantId: firestoreDocumentIdSchema,
            code: z.enum(['UNAVAILABLE', 'QUANTITY_ADJUSTED']),
            requestedQuantity: z.number().int().min(1).max(200),
            acceptedQuantity: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .max(50),
  })
  .superRefine((cart, refinementContext) => {
    const ownerCount =
      Number(cart.ownerUid !== null) +
      Number(cart.guestTokenHash !== null);

    if (ownerCount !== 1) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A cart must have exactly one customer or guest owner.',
        path: ['ownerUid'],
      });
    }

    if (
      (cart.status === 'merged') !==
      (cart.mergedIntoCartId !== null)
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Merged cart metadata must match cart state.',
        path: ['mergedIntoCartId'],
      });
    }
  });

export const cartItemDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    productId: firestoreDocumentIdSchema,
    variantId: firestoreDocumentIdSchema,
    requestedQuantity: z.number().int().min(1).max(100),
    lastDisplayedUnitPriceKobo: z.number().int().nonnegative(),
    currency: z.literal('NGN'),
    addedAt: firestoreTimestampSchema,
    updatedAt: firestoreTimestampSchema,
  })
  .strict();

export const cartMutationInputSchema = z
  .object({
    variantId: firestoreDocumentIdSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export type CartDocument = z.infer<typeof cartDocumentSchema>;
export type CartItemDocument = z.infer<typeof cartItemDocumentSchema>;
export type CartRecord = CartDocument & { id: string };
export type CartItemRecord = CartItemDocument & { id: string };
