import 'server-only';

import type { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';

import { firestoreCollections } from '@/lib/firebase/collections';
import { productVariantDocumentSchema } from '@/lib/schemas/catalogue';
import {
  inventoryBalanceDocumentSchema,
  inventoryReservationDocumentSchema,
  type InventoryBalanceRecord,
} from '@/lib/schemas/inventory';
import {
  InventoryMutationError,
  loadInventoryProjectionContexts,
  writeInventoryAvailabilityProjections,
} from '@/lib/services/inventory/InventoryService';
import { calculateStockState } from '@/lib/utils/inventory/calculateStockState';

export async function releaseCheckoutInventoryInTransaction(input: {
  transaction: Transaction;
  firestore: Firestore;
  reservationId: string;
  terminalState: 'released' | 'expired';
  reason: string;
  actorId: string;
  now: Timestamp;
}) {
  const reference = input.firestore
    .collection(firestoreCollections.inventoryReservations)
    .doc(input.reservationId);
  const snapshot = await input.transaction.get(reference);
  const parsed = inventoryReservationDocumentSchema.safeParse(snapshot.data());
  if (!snapshot.exists || !parsed.success) {
    throw new InventoryMutationError('INVALID_STATE', 'Reservation data is invalid.');
  }
  const reservation = { id: snapshot.id, ...parsed.data };
  if (reservation.state === input.terminalState) return { replay: true, reservation };
  if (reservation.state !== 'active') {
    throw new InventoryMutationError('INVALID_STATE', 'Only an active reservation can be released.');
  }

  const variants = (
    await input.transaction.getAll(
      ...reservation.lines.map((line) =>
        input.firestore
          .collection(firestoreCollections.productVariants)
          .doc(line.variantId),
      ),
    )
  ).map((variantSnapshot) => {
    const variant = productVariantDocumentSchema.safeParse(variantSnapshot.data());
    if (!variantSnapshot.exists || !variant.success) {
      throw new InventoryMutationError('INVALID_STATE', 'Product variant data is invalid.');
    }
    return { id: variantSnapshot.id, ...variant.data };
  });
  const contexts = await loadInventoryProjectionContexts(
    input.transaction,
    input.firestore,
    variants.map((variant) => variant.productId),
  );
  const nextBalances = new Map<string, InventoryBalanceRecord>();

  for (const [index, variant] of variants.entries()) {
    if (!variant.stockManaged) continue;
    const line = reservation.lines[index];
    const balance = contexts
      .get(variant.productId)
      ?.balancesByVariantId.get(variant.id);
    if (!balance || balance.reserved < line.quantity) {
      throw new InventoryMutationError('INVALID_STATE', 'Reservation balance reconciliation failed.');
    }
    const reserved = balance.reserved - line.quantity;
    const available = balance.onHand - reserved;
    const next = inventoryBalanceDocumentSchema.parse({
      ...balance,
      reserved,
      available,
      stockState: calculateStockState({
        stockManaged: true,
        available,
        lowStockThreshold: balance.lowStockThreshold,
      }),
      updatedAt: input.now,
      updatedBy: input.actorId,
      version: balance.version + 1,
    });
    nextBalances.set(variant.id, { id: variant.id, ...next });
  }

  const nextReservation = inventoryReservationDocumentSchema.parse({
    ...reservation,
    state: input.terminalState,
    committedAt: null,
    committedBy: null,
    releasedAt: input.now,
    releasedBy: input.actorId,
    releaseReason: input.reason,
    updatedAt: input.now,
    updatedBy: input.actorId,
    version: reservation.version + 1,
  });
  input.transaction.set(reference, nextReservation);
  for (const balance of nextBalances.values()) {
    input.transaction.set(
      input.firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(balance.id),
      inventoryBalanceDocumentSchema.parse(balance),
    );
  }
  writeInventoryAvailabilityProjections(
    input.transaction,
    contexts,
    nextBalances,
    input.actorId,
    input.now,
  );
  return { replay: false, reservation: { id: reservation.id, ...nextReservation } };
}
