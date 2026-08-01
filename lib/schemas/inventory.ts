import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
} from '@/lib/schemas/common';
import { calculateStockState } from '@/lib/utils/inventory/calculateStockState';

export const inventoryStockStateSchema = z.enum([
  'inStock',
  'lowStock',
  'outOfStock',
  'notManaged',
]);

const inventoryQuantitySchema = z.number().int().min(0).max(10_000_000);
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const inventoryBalanceDocumentSchema = mutableRecordFieldsSchema
  .extend({
    variantId: firestoreDocumentIdSchema,
    stockManaged: z.boolean(),
    onHand: inventoryQuantitySchema,
    reserved: inventoryQuantitySchema,
    available: inventoryQuantitySchema,
    lowStockThreshold: inventoryQuantitySchema,
    stockState: inventoryStockStateSchema,
    lastMovementAt: firestoreTimestampSchema.nullable(),
  })
  .superRefine((balance, refinementContext) => {
    if (balance.available !== balance.onHand - balance.reserved) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Available stock must equal on-hand less reserved stock.',
        path: ['available'],
      });
    }

    if (balance.reserved > balance.onHand) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reserved stock cannot exceed on-hand stock.',
        path: ['reserved'],
      });
    }

    const expectedStockState = calculateStockState(balance);

    if (balance.stockState !== expectedStockState) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Stock state does not match the authoritative balance.',
        path: ['stockState'],
      });
    }

    if (!balance.stockManaged && balance.reserved !== 0) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unmanaged stock cannot contain reservations.',
        path: ['reserved'],
      });
    }
  });

export const inventoryReservationLineSchema = z
  .object({
    variantId: firestoreDocumentIdSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export const inventoryReservationDocumentSchema = mutableRecordFieldsSchema
  .extend({
    cartId: firestoreDocumentIdSchema,
    orderId: firestoreDocumentIdSchema.nullable(),
    ownerUid: actorReferenceSchema.nullable(),
    guestTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    lines: z.array(inventoryReservationLineSchema).min(1).max(50),
    state: z.enum(['active', 'committed', 'released', 'expired']),
    purpose: z.literal('checkout'),
    paymentMethod: z
      .enum(['paystack', 'pod', 'manualTransfer', 'credit'])
      .nullable(),
    expiresAt: firestoreTimestampSchema,
    idempotencyKey: idempotencyKeySchema,
    committedAt: firestoreTimestampSchema.nullable(),
    committedBy: actorReferenceSchema.nullable(),
    releasedAt: firestoreTimestampSchema.nullable(),
    releasedBy: actorReferenceSchema.nullable(),
    releaseReason: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((reservation, refinementContext) => {
    const uniqueVariantIds = new Set(
      reservation.lines.map((line) => line.variantId),
    );
    const ownerCount =
      Number(reservation.ownerUid !== null) +
      Number(reservation.guestTokenHash !== null);

    if (ownerCount !== 1) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A reservation must have exactly one customer or guest owner.',
        path: ['ownerUid'],
      });
    }

    if (uniqueVariantIds.size !== reservation.lines.length) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A reservation can contain each variant only once.',
        path: ['lines'],
      });
    }

    const hasCommitMetadata =
      reservation.committedAt !== null &&
      reservation.committedBy !== null;
    const hasReleaseMetadata =
      reservation.releasedAt !== null &&
      reservation.releasedBy !== null &&
      reservation.releaseReason !== null;

    if (
      (reservation.state === 'committed') !== hasCommitMetadata ||
      (['released', 'expired'].includes(reservation.state)) !==
        hasReleaseMetadata
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Reservation terminal metadata must match its one-way state.',
        path: ['state'],
      });
    }

    if (
      reservation.state === 'active' &&
      (hasCommitMetadata || hasReleaseMetadata)
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Active reservations cannot contain terminal metadata.',
        path: ['state'],
      });
    }
  });

const inventoryBalanceSnapshotSchema = z
  .object({
    onHand: inventoryQuantitySchema,
    reserved: inventoryQuantitySchema,
    available: inventoryQuantitySchema,
    stockState: inventoryStockStateSchema,
  })
  .strict();

export const inventoryMovementDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    variantId: firestoreDocumentIdSchema,
    type: z.enum([
      'receipt',
      'sale',
      'return',
      'damage',
      'correction',
      'reservationCommit',
      'reversal',
    ]),
    quantityEffect: z.number().int().min(-10_000_000).max(10_000_000),
    before: inventoryBalanceSnapshotSchema,
    after: inventoryBalanceSnapshotSchema,
    referenceType: z.enum([
      'manualAdjustment',
      'reservation',
      'order',
      'reconciliation',
    ]),
    referenceId: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(3).max(500),
    actorId: actorReferenceSchema,
    idempotencyKey: idempotencyKeySchema,
    occurredAt: firestoreTimestampSchema,
  })
  .strict()
  .refine((movement) => movement.quantityEffect !== 0, {
    message: 'Inventory movements require a non-zero quantity effect.',
    path: ['quantityEffect'],
  });

export type InventoryBalanceDocument = z.infer<
  typeof inventoryBalanceDocumentSchema
>;
export type InventoryReservationDocument = z.infer<
  typeof inventoryReservationDocumentSchema
>;
export type InventoryMovementDocument = z.infer<
  typeof inventoryMovementDocumentSchema
>;
export type InventoryBalanceRecord = InventoryBalanceDocument & {
  id: string;
};
export type InventoryReservationRecord =
  InventoryReservationDocument & {
    id: string;
  };
