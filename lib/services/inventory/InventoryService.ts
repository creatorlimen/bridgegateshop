import 'server-only';

import { createHash } from 'node:crypto';

import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import type { ZodType } from 'zod';

import type { DomainErrorCode } from '@/lib/actions/actionResult';
import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  type ProductRecord,
  productDocumentSchema,
  type ProductVariantRecord,
  productVariantDocumentSchema,
} from '@/lib/schemas/catalogue';
import {
  catalogueSearchDocumentSchema,
  type CatalogueSearchDocument,
} from '@/lib/schemas/catalogueSearch';
import {
  inventoryBalanceDocumentSchema,
  type InventoryBalanceDocument,
  type InventoryBalanceRecord,
  inventoryMovementDocumentSchema,
  type InventoryMovementDocument,
  inventoryReservationDocumentSchema,
  type InventoryReservationRecord,
} from '@/lib/schemas/inventory';
import {
  adjustInventoryInputSchema,
  type AdjustInventoryInput,
  createInventoryReservationInputSchema,
  type CreateInventoryReservationInput,
  transitionInventoryReservationInputSchema,
  type TransitionInventoryReservationInput,
} from '@/lib/schemas/inventoryMutations';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import {
  calculateProductStockState,
  calculateStockState,
  type InventoryStockState,
} from '@/lib/utils/inventory/calculateStockState';

const maximumReservationLifetimeMilliseconds = 72 * 60 * 60 * 1_000;
const minimumReservationLifetimeMilliseconds = 5 * 60 * 1_000;

export type InventoryMutationActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

type InventorySystemActor = {
  actorId: string;
  requestId: string;
};

export type InventoryProjectionContext = {
  productReference: DocumentReference;
  searchReference: DocumentReference;
  product: ProductRecord;
  searchDocument: CatalogueSearchDocument | null;
  activeVariants: ProductVariantRecord[];
  balancesByVariantId: Map<string, InventoryBalanceRecord>;
};

export class InventoryMutationError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly fieldName?: string,
  ) {
    super(message);
    this.name = 'InventoryMutationError';
  }
}

function parseRecord<DocumentType>(
  snapshot: DocumentSnapshot,
  schema: ZodType<DocumentType>,
  entityLabel: string,
): DocumentType & { id: string } {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success) {
    throw new InventoryMutationError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? `${entityLabel} contains invalid stored data.`
        : `${entityLabel} was not found.`,
    );
  }

  return {
    id: snapshot.id,
    ...parsedDocument.data,
  };
}

function parseVariantDocuments(
  snapshots: readonly QueryDocumentSnapshot[],
) {
  return snapshots.map((snapshot) =>
    parseRecord(
      snapshot,
      productVariantDocumentSchema,
      'Product variant',
    ),
  );
}

function createDeterministicDocumentId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 48)}`;
}

function createInitialBalance(
  variant: ProductVariantRecord,
  now: Timestamp,
  actorId: string,
): InventoryBalanceDocument {
  const available = 0;

  return inventoryBalanceDocumentSchema.parse({
    schemaVersion: 1,
    variantId: variant.id,
    stockManaged: variant.stockManaged,
    onHand: 0,
    reserved: 0,
    available,
    lowStockThreshold: variant.lowStockThreshold,
    stockState: calculateStockState({
      stockManaged: variant.stockManaged,
      available,
      lowStockThreshold: variant.lowStockThreshold,
    }),
    lastMovementAt: null,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    version: 1,
  });
}

function getBalanceSnapshot(balance: InventoryBalanceDocument) {
  return {
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: balance.available,
    stockState: balance.stockState,
  };
}

function shouldCreateLowStockEvent(
  previousState: InventoryStockState,
  nextState: InventoryStockState,
) {
  return (
    ['inStock', 'notManaged'].includes(previousState) &&
    ['lowStock', 'outOfStock'].includes(nextState)
  );
}

export function writeInventoryLowStockEvent(
  transaction: Transaction,
  firestore: Firestore,
  balance: InventoryBalanceRecord,
  previousState: InventoryStockState,
  now: Timestamp,
) {
  if (
    !shouldCreateLowStockEvent(previousState, balance.stockState)
  ) {
    return;
  }

  const eventReference = firestore
    .collection(firestoreCollections.outboxEvents)
    .doc(`inventory-low-${balance.id}-${balance.version}`);

  transaction.create(eventReference, {
    schemaVersion: 1,
    eventName: 'inventory.lowStockThresholdCrossed',
    aggregateType: 'inventoryBalance',
    aggregateId: balance.id,
    payload: {
      variantId: balance.variantId,
      available: balance.available,
      lowStockThreshold: balance.lowStockThreshold,
      previousState,
      stockState: balance.stockState,
    },
    state: 'pending',
    attemptCount: 0,
    nextAttemptAt: now,
    leaseExpiresAt: null,
    createdAt: now,
  });
}

export async function loadInventoryProjectionContexts(
  transaction: Transaction,
  firestore: Firestore,
  productIds: readonly string[],
): Promise<Map<string, InventoryProjectionContext>> {
  const uniqueProductIds = [...new Set(productIds)].sort();
  const contexts = new Map<string, InventoryProjectionContext>();

  for (const productId of uniqueProductIds) {
    const productReference = firestore
      .collection(firestoreCollections.products)
      .doc(productId);
    const searchReference = firestore
      .collection(firestoreCollections.searchDocuments)
      .doc(`product:${productId}`);
    const variantQuery = firestore
      .collection(firestoreCollections.productVariants)
      .where('productId', '==', productId)
      .where('status', '==', 'active');
    const [productSnapshot, searchSnapshot, variantSnapshot] =
      await Promise.all([
        transaction.get(productReference),
        transaction.get(searchReference),
        transaction.get(variantQuery),
      ]);
    const product = parseRecord(
      productSnapshot,
      productDocumentSchema,
      'Product',
    );
    const activeVariants = parseVariantDocuments(variantSnapshot.docs);
    const managedVariants = activeVariants.filter(
      (variant) => variant.stockManaged,
    );
    const balanceSnapshots =
      managedVariants.length > 0
        ? await transaction.getAll(
            ...managedVariants.map((variant) =>
              firestore
                .collection(firestoreCollections.inventoryBalances)
                .doc(variant.id),
            ),
          )
        : [];
    const balancesByVariantId = new Map<
      string,
      InventoryBalanceRecord
    >();

    for (const balanceSnapshot of balanceSnapshots) {
      if (!balanceSnapshot.exists) {
        continue;
      }

      const balance = parseRecord(
        balanceSnapshot,
        inventoryBalanceDocumentSchema,
        'Inventory balance',
      );
      balancesByVariantId.set(balance.variantId, balance);
    }

    let searchDocument: CatalogueSearchDocument | null = null;

    if (searchSnapshot.exists) {
      const parsedSearchDocument =
        catalogueSearchDocumentSchema.safeParse(searchSnapshot.data());

      if (!parsedSearchDocument.success) {
        throw new InventoryMutationError(
          'INVALID_STATE',
          'The product search projection contains invalid stored data.',
        );
      }

      searchDocument = parsedSearchDocument.data;
    }

    contexts.set(productId, {
      productReference,
      searchReference,
      product,
      searchDocument,
      activeVariants,
      balancesByVariantId,
    });
  }

  return contexts;
}

export function writeInventoryAvailabilityProjections(
  transaction: Transaction,
  contexts: ReadonlyMap<string, InventoryProjectionContext>,
  balanceOverrides: ReadonlyMap<string, InventoryBalanceRecord>,
  actorId: string,
  now: Timestamp,
) {
  for (const context of contexts.values()) {
    const variantStates = context.activeVariants.map((variant) => {
      if (!variant.stockManaged) {
        return 'notManaged' as const;
      }

      return (
        balanceOverrides.get(variant.id) ??
        context.balancesByVariantId.get(variant.id)
      )?.stockState ?? 'outOfStock';
    });
    const stockState = calculateProductStockState(variantStates);
    let productStatus = context.product.status;

    if (
      context.product.status === 'active' &&
      stockState === 'outOfStock'
    ) {
      productStatus = 'outOfStock';
    } else if (
      context.product.status === 'outOfStock' &&
      stockState !== 'outOfStock'
    ) {
      productStatus = 'active';
    }

    const projectionChanged =
      context.product.availabilitySummary.stockState !== stockState ||
      context.product.status !== productStatus;

    if (!projectionChanged) {
      continue;
    }

    const updatedProduct = productDocumentSchema.parse({
      ...context.product,
      status: productStatus,
      availabilitySummary: {
        ...context.product.availabilitySummary,
        stockState,
      },
      updatedAt: now,
      updatedBy: actorId,
      version: context.product.version + 1,
    });

    transaction.set(context.productReference, updatedProduct);

    if (context.searchDocument) {
      transaction.set(
        context.searchReference,
        catalogueSearchDocumentSchema.parse({
          ...context.searchDocument,
          stockState,
          updatedAt: now,
        }),
      );
    }
  }
}

function assertMovementDirection(input: AdjustInventoryInput) {
  if (
    ['receipt', 'return'].includes(input.movementType) &&
    input.quantityDelta < 0
  ) {
    throw new InventoryMutationError(
      'VALIDATION_FAILED',
      'Receipts and returns must increase on-hand stock.',
      'quantityDelta',
    );
  }

  if (
    input.movementType === 'damage' &&
    input.quantityDelta > 0
  ) {
    throw new InventoryMutationError(
      'VALIDATION_FAILED',
      'Damage adjustments must reduce on-hand stock.',
      'quantityDelta',
    );
  }
}

function assertReservationLifetime(expiresAt: Date, now: Date) {
  const lifetime = expiresAt.getTime() - now.getTime();

  if (
    lifetime < minimumReservationLifetimeMilliseconds ||
    lifetime > maximumReservationLifetimeMilliseconds
  ) {
    throw new InventoryMutationError(
      'VALIDATION_FAILED',
      'Reservation expiry must be between 5 minutes and 72 hours.',
      'expiresAt',
    );
  }
}

function assertReservationReplay(
  reservation: InventoryReservationRecord,
  input: CreateInventoryReservationInput,
) {
  const requestedLines = [...input.lines].sort((leftLine, rightLine) =>
    leftLine.variantId.localeCompare(rightLine.variantId, 'en'),
  );

  if (
    reservation.idempotencyKey !== input.idempotencyKey ||
    reservation.cartId !== input.cartId ||
    reservation.ownerUid !== input.ownerUid ||
    reservation.guestTokenHash !== input.guestTokenHash ||
    reservation.paymentMethod !== input.paymentMethod ||
    (reservation.expiresAt instanceof Date
      ? reservation.expiresAt.getTime()
      : reservation.expiresAt.toMillis()) !== input.expiresAt.getTime() ||
    JSON.stringify(reservation.lines) !== JSON.stringify(requestedLines)
  ) {
    throw new InventoryMutationError(
      'CONFLICT',
      'That idempotency key was already used for another reservation.',
      'idempotencyKey',
    );
  }
}

class FirestoreInventoryService {
  constructor(private readonly firestore: Firestore) {}

  async adjustBalance(
    unparsedInput: AdjustInventoryInput,
    actor: InventoryMutationActor,
  ): Promise<{ balance: InventoryBalanceRecord; replay: boolean }> {
    const input = adjustInventoryInputSchema.parse(unparsedInput);
    assertMovementDirection(input);
    const variantReference = this.firestore
      .collection(firestoreCollections.productVariants)
      .doc(input.variantId);
    const balanceReference = this.firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(input.variantId);
    const movementReference = this.firestore
      .collection(firestoreCollections.inventoryMovements)
      .doc(
        createDeterministicDocumentId(
          'adjustment',
          input.idempotencyKey,
        ),
      );

    return this.firestore.runTransaction(async (transaction) => {
      const [variantSnapshot, balanceSnapshot, movementSnapshot] =
        await transaction.getAll(
          variantReference,
          balanceReference,
          movementReference,
        );
      const variant = parseRecord(
        variantSnapshot,
        productVariantDocumentSchema,
        'Product variant',
      );

      if (variant.status === 'archived' || !variant.stockManaged) {
        throw new InventoryMutationError(
          'INVALID_STATE',
          'Only a managed, non-archived variant can be adjusted.',
        );
      }

      if (movementSnapshot.exists) {
        const movement = inventoryMovementDocumentSchema.safeParse(
          movementSnapshot.data(),
        );

        if (
          !movement.success ||
          movement.data.idempotencyKey !== input.idempotencyKey
        ) {
          throw new InventoryMutationError(
            'CONFLICT',
            'That adjustment idempotency key is already in use.',
          );
        }

        return {
          balance: parseRecord(
            balanceSnapshot,
            inventoryBalanceDocumentSchema,
            'Inventory balance',
          ),
          replay: true,
        };
      }

      const now = Timestamp.now();
      const currentBalance = balanceSnapshot.exists
        ? parseRecord(
            balanceSnapshot,
            inventoryBalanceDocumentSchema,
            'Inventory balance',
          )
        : {
            id: input.variantId,
            ...createInitialBalance(variant, now, actor.actorId),
          };
      const currentVersion = balanceSnapshot.exists
        ? currentBalance.version
        : 0;

      if (currentVersion !== input.expectedVersion) {
        throw new InventoryMutationError(
          'CONFLICT',
          'This balance changed after the page loaded. Refresh and retry.',
          'expectedVersion',
        );
      }

      const nextOnHand =
        currentBalance.onHand + input.quantityDelta;

      if (
        nextOnHand < 0 ||
        nextOnHand < currentBalance.reserved
      ) {
        throw new InventoryMutationError(
          'OUT_OF_STOCK',
          'The adjustment would reduce stock below active reservations.',
          'quantityDelta',
        );
      }

      const nextAvailable = nextOnHand - currentBalance.reserved;
      const nextBalanceDocument = inventoryBalanceDocumentSchema.parse({
        ...currentBalance,
        stockManaged: true,
        onHand: nextOnHand,
        available: nextAvailable,
        lowStockThreshold: variant.lowStockThreshold,
        stockState: calculateStockState({
          stockManaged: true,
          available: nextAvailable,
          lowStockThreshold: variant.lowStockThreshold,
        }),
        lastMovementAt: now,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentVersion + 1,
      });
      const nextBalance: InventoryBalanceRecord = {
        id: input.variantId,
        ...nextBalanceDocument,
      };
      const contexts = await loadInventoryProjectionContexts(
        transaction,
        this.firestore,
        [variant.productId],
      );
      const movement: InventoryMovementDocument =
        inventoryMovementDocumentSchema.parse({
          schemaVersion: 1,
          variantId: variant.id,
          type: input.movementType,
          quantityEffect: input.quantityDelta,
          before: getBalanceSnapshot(currentBalance),
          after: getBalanceSnapshot(nextBalanceDocument),
          referenceType: 'manualAdjustment',
          referenceId: movementReference.id,
          reason: input.reason,
          actorId: actor.actorId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: now,
        });

      transaction.set(balanceReference, nextBalanceDocument);
      transaction.create(movementReference, movement);
      writeInventoryLowStockEvent(
        transaction,
        this.firestore,
        nextBalance,
        currentBalance.stockState,
        now,
      );
      writeInventoryAvailabilityProjections(
        transaction,
        contexts,
        new Map([[variant.id, nextBalance]]),
        actor.actorId,
        now,
      );
      writeAuditEvent(transaction, this.firestore, {
        actorId: actor.actorId,
        actorRoleIds: actor.roleIds,
        action: 'inventory.balance.adjust',
        entityType: 'inventoryBalance',
        entityId: variant.id,
        publicReference: variant.sku,
        requestId: actor.requestId,
        changedFields: ['onHand', 'available', 'stockState'],
        reason: input.reason,
      });

      return { balance: nextBalance, replay: false };
    });
  }

  async createReservation(
    unparsedInput: CreateInventoryReservationInput,
    actor: InventorySystemActor = {
      actorId: 'system:checkout',
      requestId: 'system-checkout',
    },
  ): Promise<{
    reservation: InventoryReservationRecord;
    replay: boolean;
  }> {
    const input =
      createInventoryReservationInputSchema.parse(unparsedInput);
    assertReservationLifetime(input.expiresAt, new Date());
    const reservationId = createDeterministicDocumentId(
      'reservation',
      input.idempotencyKey,
    );
    const reservationReference = this.firestore
      .collection(firestoreCollections.inventoryReservations)
      .doc(reservationId);

    return this.firestore.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(
        reservationReference,
      );

      if (existingSnapshot.exists) {
        const reservation = parseRecord(
          existingSnapshot,
          inventoryReservationDocumentSchema,
          'Inventory reservation',
        );
        assertReservationReplay(reservation, input);
        return { reservation, replay: true };
      }

      const sortedLines = [...input.lines].sort(
        (leftLine, rightLine) =>
          leftLine.variantId.localeCompare(
            rightLine.variantId,
            'en',
          ),
      );
      const uniqueVariantIds = new Set(
        sortedLines.map((line) => line.variantId),
      );

      if (uniqueVariantIds.size !== sortedLines.length) {
        throw new InventoryMutationError(
          'VALIDATION_FAILED',
          'A reservation can contain each variant only once.',
          'lines',
        );
      }

      const variantSnapshots = await transaction.getAll(
        ...sortedLines.map((line) =>
          this.firestore
            .collection(firestoreCollections.productVariants)
            .doc(line.variantId),
        ),
      );
      const variants = variantSnapshots.map((snapshot) =>
        parseRecord(
          snapshot,
          productVariantDocumentSchema,
          'Product variant',
        ),
      );
      const contexts = await loadInventoryProjectionContexts(
        transaction,
        this.firestore,
        variants.map((variant) => variant.productId),
      );
      const nextBalances = new Map<string, InventoryBalanceRecord>();
      const now = Timestamp.now();

      for (const [variantIndex, variant] of variants.entries()) {
        const line = sortedLines[variantIndex];
        const product = contexts.get(variant.productId)?.product;

        if (
          variant.status !== 'active' ||
          !product ||
          product.status !== 'active'
        ) {
          throw new InventoryMutationError(
            'INVALID_STATE',
            'A requested product variant is no longer purchasable.',
          );
        }

        if (!variant.stockManaged) {
          continue;
        }

        const currentBalance = contexts
          .get(variant.productId)
          ?.balancesByVariantId.get(variant.id);

        if (
          !currentBalance ||
          currentBalance.available < line.quantity
        ) {
          throw new InventoryMutationError(
            'OUT_OF_STOCK',
            'A requested quantity is no longer available.',
            variant.id,
          );
        }

        const nextReserved =
          currentBalance.reserved + line.quantity;
        const nextAvailable =
          currentBalance.onHand - nextReserved;
        const nextBalanceDocument =
          inventoryBalanceDocumentSchema.parse({
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
        const nextBalance = {
          id: variant.id,
          ...nextBalanceDocument,
        };

        nextBalances.set(variant.id, nextBalance);
      }

      const reservationDocument =
        inventoryReservationDocumentSchema.parse({
          schemaVersion: 1,
          cartId: input.cartId,
          orderId: input.orderId ?? null,
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
          this.firestore
            .collection(firestoreCollections.inventoryBalances)
            .doc(nextBalance.id),
          inventoryBalanceDocumentSchema.parse(nextBalance),
        );
        const context = [...contexts.values()].find((candidate) =>
          candidate.activeVariants.some(
            (variant) => variant.id === nextBalance.id,
          ),
        );
        const previousState =
          context?.balancesByVariantId.get(nextBalance.id)?.stockState;

        if (previousState) {
          writeInventoryLowStockEvent(
            transaction,
            this.firestore,
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
        reservation: {
          id: reservationId,
          ...reservationDocument,
        },
        replay: false,
      };
    });
  }

  async releaseReservation(
    unparsedInput: TransitionInventoryReservationInput,
    actor: InventorySystemActor = {
      actorId: 'system:reservation-release',
      requestId: 'system-reservation-release',
    },
    terminalState: 'released' | 'expired' = 'released',
  ) {
    const input =
      transitionInventoryReservationInputSchema.parse(unparsedInput);

    return this.transitionReservation(
      input,
      actor,
      terminalState,
    );
  }

  async commitReservation(
    unparsedInput: TransitionInventoryReservationInput,
    actor: InventorySystemActor = {
      actorId: 'system:reservation-commit',
      requestId: 'system-reservation-commit',
    },
  ) {
    const input =
      transitionInventoryReservationInputSchema.parse(unparsedInput);
    return this.transitionReservation(input, actor, 'committed');
  }

  private async transitionReservation(
    input: TransitionInventoryReservationInput,
    actor: InventorySystemActor,
    terminalState: 'committed' | 'released' | 'expired',
  ): Promise<{
    reservation: InventoryReservationRecord;
    replay: boolean;
  }> {
    const reservationReference = this.firestore
      .collection(firestoreCollections.inventoryReservations)
      .doc(input.reservationId);

    return this.firestore.runTransaction(async (transaction) => {
      const reservationSnapshot = await transaction.get(
        reservationReference,
      );
      const currentReservation = parseRecord(
        reservationSnapshot,
        inventoryReservationDocumentSchema,
        'Inventory reservation',
      );

      if (currentReservation.state === terminalState) {
        return { reservation: currentReservation, replay: true };
      }

      if (currentReservation.state !== 'active') {
        throw new InventoryMutationError(
          'INVALID_STATE',
          'A terminal reservation cannot transition again.',
        );
      }

      const variants = (
        await transaction.getAll(
          ...currentReservation.lines.map((line) =>
            this.firestore
              .collection(firestoreCollections.productVariants)
              .doc(line.variantId),
          ),
        )
      ).map((snapshot) =>
        parseRecord(
          snapshot,
          productVariantDocumentSchema,
          'Product variant',
        ),
      );
      const contexts = await loadInventoryProjectionContexts(
        transaction,
        this.firestore,
        variants.map((variant) => variant.productId),
      );
      const movementReferences =
        terminalState === 'committed'
          ? variants
              .filter((variant) => variant.stockManaged)
              .map((variant) =>
                this.firestore
                  .collection(firestoreCollections.inventoryMovements)
                  .doc(
                    createDeterministicDocumentId(
                      'commit',
                      `${currentReservation.id}:${variant.id}`,
                    ),
                  ),
              )
          : [];
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

      const now = Timestamp.now();
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

        if (
          !currentBalance ||
          currentBalance.reserved < line.quantity
        ) {
          throw new InventoryMutationError(
            'INVALID_STATE',
            'Reservation balance reconciliation failed.',
          );
        }

        const nextOnHand =
          terminalState === 'committed'
            ? currentBalance.onHand - line.quantity
            : currentBalance.onHand;
        const nextReserved =
          currentBalance.reserved - line.quantity;
        const nextAvailable = nextOnHand - nextReserved;
        const nextBalanceDocument =
          inventoryBalanceDocumentSchema.parse({
            ...currentBalance,
            onHand: nextOnHand,
            reserved: nextReserved,
            available: nextAvailable,
            stockState: calculateStockState({
              stockManaged: true,
              available: nextAvailable,
              lowStockThreshold: currentBalance.lowStockThreshold,
            }),
            lastMovementAt:
              terminalState === 'committed'
                ? now
                : currentBalance.lastMovementAt,
            updatedAt: now,
            updatedBy: actor.actorId,
            version: currentBalance.version + 1,
          });
        const nextBalance = {
          id: variant.id,
          ...nextBalanceDocument,
        };

        nextBalances.set(variant.id, nextBalance);

        if (terminalState === 'committed') {
          const movementReference =
            movementReferences[movements.length];
          movements.push({
            reference: movementReference,
            document: inventoryMovementDocumentSchema.parse({
              schemaVersion: 1,
              variantId: variant.id,
              type: 'reservationCommit',
              quantityEffect: -line.quantity,
              before: getBalanceSnapshot(currentBalance),
              after: getBalanceSnapshot(nextBalanceDocument),
              referenceType: 'reservation',
              referenceId: currentReservation.id,
              reason: input.reason,
              actorId: actor.actorId,
              idempotencyKey: input.idempotencyKey,
              occurredAt: now,
            }),
          });
        }
      }

      const nextReservationDocument =
        inventoryReservationDocumentSchema.parse({
          ...currentReservation,
          state: terminalState,
          committedAt:
            terminalState === 'committed' ? now : null,
          committedBy:
            terminalState === 'committed' ? actor.actorId : null,
          releasedAt:
            terminalState === 'committed' ? null : now,
          releasedBy:
            terminalState === 'committed' ? null : actor.actorId,
          releaseReason:
            terminalState === 'committed' ? null : input.reason,
          updatedAt: now,
          updatedBy: actor.actorId,
          version: currentReservation.version + 1,
        });

      transaction.set(reservationReference, nextReservationDocument);

      for (const nextBalance of nextBalances.values()) {
        transaction.set(
          this.firestore
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
        reservation: {
          id: currentReservation.id,
          ...nextReservationDocument,
        },
        replay: false,
      };
    });
  }

  async expireDueReservations(
    now = new Date(),
    limit = 100,
  ): Promise<{ expired: number }> {
    const dueSnapshot = await this.firestore
      .collection(firestoreCollections.inventoryReservations)
      .where('state', '==', 'active')
      .where('expiresAt', '<=', Timestamp.fromDate(now))
      .orderBy('expiresAt', 'asc')
      .limit(Math.max(1, Math.min(limit, 100)))
      .get();
    let expired = 0;

    for (const reservationDocument of dueSnapshot.docs) {
      const result = await this.releaseReservation(
        {
          reservationId: reservationDocument.id,
          idempotencyKey: `expire:${reservationDocument.id}:v1`,
          reason: 'Reservation hold elapsed before order confirmation.',
        },
        {
          actorId: 'system:reservation-expiry',
          requestId: `expiry-${reservationDocument.id}`,
        },
        'expired',
      );

      if (!result.replay) {
        expired += 1;
      }
    }

    return { expired };
  }
}

export type InventoryService = FirestoreInventoryService;

export function createInventoryService(
  firestore: Firestore = getFirebaseAdminFirestore(),
): InventoryService {
  return new FirestoreInventoryService(firestore);
}
