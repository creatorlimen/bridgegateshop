import 'server-only';

import { createHash } from 'node:crypto';

import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { firestoreCollections } from '@/lib/firebase/collections';
import {
  productVariantDocumentSchema,
  type ProductVariantRecord,
} from '@/lib/schemas/catalogue';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import {
  inventoryBalanceDocumentSchema,
  type InventoryBalanceRecord,
  inventoryMovementDocumentSchema,
  type InventoryMovementDocument,
  inventoryReservationDocumentSchema,
  type InventoryReservationRecord,
} from '@/lib/schemas/inventory';
import {
  createInventoryReservationInputSchema,
  type CreateInventoryReservationInput,
} from '@/lib/schemas/inventoryMutations';
import {
  InventoryMutationError,
  loadInventoryProjectionContexts,
  writeInventoryAvailabilityProjections,
  writeInventoryLowStockEvent,
} from '@/lib/services/inventory/InventoryService';
import { calculateStockState } from '@/lib/utils/inventory/calculateStockState';

type InventorySystemActor = {
  actorId: string;
  requestId: string;
};

const minimumReservationLifetimeMilliseconds = 5 * 60 * 1_000;
const maximumReservationLifetimeMilliseconds = 72 * 60 * 60 * 1_000;

function deterministicDocumentId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 48)}`;
}

function parseVariant(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsedVariant = productVariantDocumentSchema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedVariant.success) {
    throw new InventoryMutationError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? 'Product variant contains invalid stored data.'
        : 'Product variant was not found.',
    );
  }

  return { id: snapshot.id, ...parsedVariant.data };
}

function parseReservation(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsedReservation = inventoryReservationDocumentSchema.safeParse(
    snapshot.data(),
  );

  if (!snapshot.exists || !parsedReservation.success) {
    throw new InventoryMutationError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? 'Inventory reservation contains invalid stored data.'
        : 'Inventory reservation was not found.',
    );
  }

  return { id: snapshot.id, ...parsedReservation.data };
}

function getBalanceSnapshot(
  balance: Pick<
    InventoryBalanceRecord,
    'onHand' | 'reserved' | 'available' | 'stockState'
  >,
) {
  return {
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: balance.available,
    stockState: balance.stockState,
  };
}

export function getCheckoutReservationId(orderId: string) {
  return deterministicDocumentId('reservation', `checkout:${orderId}`);
}

export async function reserveCheckoutInventoryInTransaction({
  transaction,
  firestore,
  unparsedInput,
  actor,
  now,
}: {
  transaction: Transaction;
  firestore: Firestore;
  unparsedInput: CreateInventoryReservationInput;
  actor: InventorySystemActor;
  now: Timestamp;
}): Promise<{ reservation: InventoryReservationRecord; replay: boolean }> {
  const input = createInventoryReservationInputSchema.parse(unparsedInput);
  const lifetimeMilliseconds = input.expiresAt.getTime() - now.toMillis();

  if (
    lifetimeMilliseconds < minimumReservationLifetimeMilliseconds ||
    lifetimeMilliseconds > maximumReservationLifetimeMilliseconds
  ) {
    throw new InventoryMutationError(
      'VALIDATION_FAILED',
      'Reservation lifetime is outside the safe configured range.',
      'expiresAt',
    );
  }

  const reservationId = input.orderId
    ? getCheckoutReservationId(input.orderId)
    : deterministicDocumentId('reservation', input.idempotencyKey);
  const reservationReference = firestore
    .collection(firestoreCollections.inventoryReservations)
    .doc(reservationId);
  const existingSnapshot = await transaction.get(reservationReference);

  if (existingSnapshot.exists) {
    const existingReservation = parseReservation(existingSnapshot);
    const replayMatches =
      existingReservation.cartId === input.cartId &&
      existingReservation.orderId === input.orderId &&
      existingReservation.ownerUid === input.ownerUid &&
      existingReservation.guestTokenHash === input.guestTokenHash &&
      existingReservation.paymentMethod === input.paymentMethod &&
      existingReservation.idempotencyKey === input.idempotencyKey &&
      firestoreTimestampToDate(existingReservation.expiresAt).getTime() ===
        input.expiresAt.getTime() &&
      JSON.stringify(existingReservation.lines) ===
        JSON.stringify([...input.lines].sort((leftLine, rightLine) =>
          leftLine.variantId.localeCompare(rightLine.variantId, 'en'),
        ));

    if (!replayMatches) {
      throw new InventoryMutationError(
        'CONFLICT',
        'The reservation idempotency key was reused with different data.',
      );
    }

    return { reservation: existingReservation, replay: true };
  }

  const sortedLines = [...input.lines].sort((leftLine, rightLine) =>
    leftLine.variantId.localeCompare(rightLine.variantId, 'en'),
  );

  if (new Set(sortedLines.map((line) => line.variantId)).size !== sortedLines.length) {
    throw new InventoryMutationError(
      'VALIDATION_FAILED',
      'A reservation can contain each variant only once.',
      'lines',
    );
  }

  const variants = (
    await transaction.getAll(
      ...sortedLines.map((line) =>
        firestore
          .collection(firestoreCollections.productVariants)
          .doc(line.variantId),
      ),
    )
  ).map(parseVariant);
  const contexts = await loadInventoryProjectionContexts(
    transaction,
    firestore,
    variants.map((variant) => variant.productId),
  );
  const nextBalances = new Map<string, InventoryBalanceRecord>();

  for (const [variantIndex, variant] of variants.entries()) {
    const line = sortedLines[variantIndex];
    const context = contexts.get(variant.productId);

    if (variant.status !== 'active' || context?.product.status !== 'active') {
      throw new InventoryMutationError(
        'INVALID_STATE',
        'A requested product variant is no longer purchasable.',
      );
    }

    if (!variant.stockManaged) {
      continue;
    }

    const currentBalance = context.balancesByVariantId.get(variant.id);

    if (!currentBalance || currentBalance.available < line.quantity) {
      throw new InventoryMutationError(
        'OUT_OF_STOCK',
        'A requested quantity is no longer available.',
        variant.id,
      );
    }

    const nextReserved = currentBalance.reserved + line.quantity;
    const nextAvailable = currentBalance.onHand - nextReserved;
    const nextBalanceDocument = inventoryBalanceDocumentSchema.parse({
      ...currentBalance,
      reserved: nextReserved,
      available: nextAvailable,
      stockState: calculateStockState({
        stockManaged: true,
        available: nextAvailable,
        lowStockThreshold: currentBalance.lowStockThreshold,
      }),
      updatedAt: now,
      updatedBy: actor.actorId,
      version: currentBalance.version + 1,
    });

    nextBalances.set(variant.id, { id: variant.id, ...nextBalanceDocument });
  }

  const reservationDocument = inventoryReservationDocumentSchema.parse({
    schemaVersion: 1,
    cartId: input.cartId,
    orderId: input.orderId,
    ownerUid: input.ownerUid,
    guestTokenHash: input.guestTokenHash,
    lines: sortedLines,
    state: 'active',
    purpose: 'checkout',
    paymentMethod: input.paymentMethod,
    expiresAt: Timestamp.fromDate(input.expiresAt),
    idempotencyKey: input.idempotencyKey,
    committedAt: null,
    committedBy: null,
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    createdAt: now,
    createdBy: actor.actorId,
    updatedAt: now,
    updatedBy: actor.actorId,
    version: 1,
  });

  transaction.create(reservationReference, reservationDocument);

  for (const nextBalance of nextBalances.values()) {
    transaction.set(
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(nextBalance.id),
      inventoryBalanceDocumentSchema.parse(nextBalance),
    );
    const context = [...contexts.values()].find((candidate) =>
      candidate.activeVariants.some((variant) => variant.id === nextBalance.id),
    );
    const previousState = context?.balancesByVariantId.get(nextBalance.id)?.stockState;

    if (previousState) {
      writeInventoryLowStockEvent(
        transaction,
        firestore,
        nextBalance,
        previousState,
        now,
      );
    }
  }

  writeInventoryAvailabilityProjections(
    transaction,
    contexts,
    nextBalances,
    actor.actorId,
    now,
  );

  return {
    reservation: { id: reservationId, ...reservationDocument },
    replay: false,
  };
}

export async function commitCheckoutInventoryInTransaction({
  transaction,
  firestore,
  reservationId,
  idempotencyKey,
  reason,
  actor,
  now,
}: {
  transaction: Transaction;
  firestore: Firestore;
  reservationId: string;
  idempotencyKey: string;
  reason: string;
  actor: InventorySystemActor;
  now: Timestamp;
}): Promise<{ reservation: InventoryReservationRecord; replay: boolean }> {
  const reservationReference = firestore
    .collection(firestoreCollections.inventoryReservations)
    .doc(reservationId);
  const reservationSnapshot = await transaction.get(reservationReference);
  const currentReservation = parseReservation(reservationSnapshot);

  if (currentReservation.state === 'committed') {
    return { reservation: currentReservation, replay: true };
  }

  if (
    currentReservation.state !== 'active' ||
    firestoreTimestampToDate(currentReservation.expiresAt).getTime() <= now.toMillis()
  ) {
    throw new InventoryMutationError(
      'INVALID_STATE',
      'The checkout reservation is no longer eligible for commit.',
    );
  }

  const variants: ProductVariantRecord[] = (
    await transaction.getAll(
      ...currentReservation.lines.map((line) =>
        firestore
          .collection(firestoreCollections.productVariants)
          .doc(line.variantId),
      ),
    )
  ).map(parseVariant);
  const contexts = await loadInventoryProjectionContexts(
    transaction,
    firestore,
    variants.map((variant) => variant.productId),
  );
  const movementReferences = variants
    .filter((variant) => variant.stockManaged)
    .map((variant) =>
      firestore.collection(firestoreCollections.inventoryMovements).doc(
        deterministicDocumentId(
          'commit',
          `${currentReservation.id}:${variant.id}`,
        ),
      ),
    );
  const movementSnapshots =
    movementReferences.length > 0
      ? await transaction.getAll(...movementReferences)
      : [];

  if (movementSnapshots.some((snapshot) => snapshot.exists)) {
    throw new InventoryMutationError(
      'INVALID_STATE',
      'Reservation movement state is inconsistent.',
    );
  }

  const nextBalances = new Map<string, InventoryBalanceRecord>();
  const movements: Array<{
    reference: DocumentReference;
    document: InventoryMovementDocument;
  }> = [];

  for (const [variantIndex, variant] of variants.entries()) {
    if (!variant.stockManaged) {
      continue;
    }

    const line = currentReservation.lines[variantIndex];
    const currentBalance = contexts
      .get(variant.productId)
      ?.balancesByVariantId.get(variant.id);

    if (!currentBalance || currentBalance.reserved < line.quantity) {
      throw new InventoryMutationError(
        'INVALID_STATE',
        'Reservation balance reconciliation failed.',
      );
    }

    const nextOnHand = currentBalance.onHand - line.quantity;
    const nextReserved = currentBalance.reserved - line.quantity;
    const nextAvailable = nextOnHand - nextReserved;
    const nextBalanceDocument = inventoryBalanceDocumentSchema.parse({
      ...currentBalance,
      onHand: nextOnHand,
      reserved: nextReserved,
      available: nextAvailable,
      stockState: calculateStockState({
        stockManaged: true,
        available: nextAvailable,
        lowStockThreshold: currentBalance.lowStockThreshold,
      }),
      lastMovementAt: now,
      updatedAt: now,
      updatedBy: actor.actorId,
      version: currentBalance.version + 1,
    });
    const nextBalance = { id: variant.id, ...nextBalanceDocument };
    const movementReference = movementReferences[movements.length];

    nextBalances.set(variant.id, nextBalance);
    movements.push({
      reference: movementReference,
      document: inventoryMovementDocumentSchema.parse({
        schemaVersion: 1,
        variantId: variant.id,
        type: 'reservationCommit',
        quantityEffect: -line.quantity,
        before: getBalanceSnapshot(currentBalance),
        after: getBalanceSnapshot(nextBalance),
        referenceType: 'order',
        referenceId: currentReservation.orderId ?? currentReservation.id,
        reason,
        actorId: actor.actorId,
        idempotencyKey,
        occurredAt: now,
      }),
    });
  }

  const nextReservationDocument = inventoryReservationDocumentSchema.parse({
    ...currentReservation,
    state: 'committed',
    committedAt: now,
    committedBy: actor.actorId,
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    updatedAt: now,
    updatedBy: actor.actorId,
    version: currentReservation.version + 1,
  });

  transaction.set(reservationReference, nextReservationDocument);
  for (const nextBalance of nextBalances.values()) {
    transaction.set(
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(nextBalance.id),
      inventoryBalanceDocumentSchema.parse(nextBalance),
    );
  }
  for (const movement of movements) {
    transaction.create(movement.reference, movement.document);
  }
  writeInventoryAvailabilityProjections(
    transaction,
    contexts,
    nextBalances,
    actor.actorId,
    now,
  );

  return {
    reservation: { id: currentReservation.id, ...nextReservationDocument },
    replay: false,
  };
}

