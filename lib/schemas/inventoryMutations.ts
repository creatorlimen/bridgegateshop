import { z } from 'zod';

import { firestoreDocumentIdSchema } from '@/lib/schemas/common';
import { inventoryReservationLineSchema } from '@/lib/schemas/inventory';

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const adjustInventoryInputSchema = z
  .object({
    variantId: firestoreDocumentIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    quantityDelta: z
      .number()
      .int()
      .min(-10_000_000)
      .max(10_000_000)
      .refine((quantity) => quantity !== 0),
    movementType: z.enum([
      'receipt',
      'return',
      'damage',
      'correction',
      'reversal',
    ]),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const createInventoryReservationInputSchema = z
  .object({
    cartId: firestoreDocumentIdSchema,
    ownerUid: z.string().trim().min(1).max(160).nullable(),
    guestTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    lines: z.array(inventoryReservationLineSchema).min(1).max(50),
    paymentMethod: z
      .enum(['paystack', 'pod', 'manualTransfer', 'credit'])
      .nullable(),
    expiresAt: z.date(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const transitionInventoryReservationInputSchema = z
  .object({
    reservationId: firestoreDocumentIdSchema,
    idempotencyKey: idempotencyKeySchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type AdjustInventoryInput = z.infer<
  typeof adjustInventoryInputSchema
>;
export type CreateInventoryReservationInput = z.infer<
  typeof createInventoryReservationInputSchema
>;
export type TransitionInventoryReservationInput = z.infer<
  typeof transitionInventoryReservationInputSchema
>;
