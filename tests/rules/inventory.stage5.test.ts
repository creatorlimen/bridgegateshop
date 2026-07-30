import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  createCatalogueMutationService,
  type CatalogueMutationActor,
} from '@/lib/services/catalogue/CatalogueMutationService';
import {
  createInventoryService,
  type InventoryMutationActor,
} from '@/lib/services/inventory/InventoryService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const inventoryActor: InventoryMutationActor = {
  actorId: 'stage5-inventory-manager',
  roleIds: ['fulfilmentStaff'],
  requestId: 'request-stage5-inventory',
};
const catalogueActor: CatalogueMutationActor = {
  actorId: 'stage5-owner',
  roleIds: ['owner'],
  requestId: 'request-stage5-catalogue',
};
const signatureVariantId = 'variant-product-signature-pop';
const smoothFinishVariantId = 'variant-product-smooth-finish-pop';
let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedCatalogue(getFirebaseAdminFirestore());
});

afterAll(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.cleanup();
});

describe('Stage 5 inventory and reservation application layer', () => {
  it('applies an audited inventory adjustment exactly once', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createInventoryService(firestore);
    const input = {
      variantId: signatureVariantId,
      expectedVersion: 1,
      quantityDelta: 5,
      movementType: 'receipt' as const,
      reason: 'Stage 5 receiving test.',
      idempotencyKey: 'stage5-adjustment-receipt-001',
    };

    const firstResult = await service.adjustBalance(input, inventoryActor);
    const replayResult = await service.adjustBalance(input, inventoryActor);
    const [movementSnapshot, auditSnapshot] = await Promise.all([
      firestore
        .collection(firestoreCollections.inventoryMovements)
        .where('idempotencyKey', '==', input.idempotencyKey)
        .get(),
      firestore
        .collection(firestoreCollections.auditEvents)
        .where('entityId', '==', signatureVariantId)
        .where('action', '==', 'inventory.balance.adjust')
        .get(),
    ]);

    expect(firstResult.replay).toBe(false);
    expect(firstResult.balance).toMatchObject({
      onHand: 45,
      reserved: 0,
      available: 45,
      stockState: 'inStock',
      version: 2,
    });
    expect(replayResult.replay).toBe(true);
    expect(replayResult.balance.version).toBe(2);
    expect(movementSnapshot.size).toBe(1);
    expect(auditSnapshot.size).toBe(1);
  });

  it('allows only one winner when reservations race for scarce stock', async () => {
    const service = createInventoryService(getFirebaseAdminFirestore());
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    const attempts = await Promise.allSettled(
      ['first', 'second'].map((suffix) =>
        service.createReservation({
          cartId: `cart-race-${suffix}`,
          ownerUid: `customer-${suffix}`,
          guestTokenHash: null,
          lines: [{ variantId: smoothFinishVariantId, quantity: 2 }],
          paymentMethod: 'paystack',
          expiresAt,
          idempotencyKey: `stage5-reservation-race-${suffix}`,
        }),
      ),
    );
    const balanceSnapshot = await getFirebaseAdminFirestore()
      .collection(firestoreCollections.inventoryBalances)
      .doc(smoothFinishVariantId)
      .get();

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    expect(balanceSnapshot.data()).toMatchObject({
      onHand: 3,
      reserved: 2,
      available: 1,
      stockState: 'lowStock',
    });
  });

  it('releases reservations idempotently and restores availability', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createInventoryService(firestore);
    const created = await service.createReservation({
      cartId: 'cart-release-stage5',
      ownerUid: 'customer-release-stage5',
      guestTokenHash: null,
      lines: [{ variantId: signatureVariantId, quantity: 3 }],
      paymentMethod: 'paystack',
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      idempotencyKey: 'stage5-reservation-release-create',
    });
    const transitionInput = {
      reservationId: created.reservation.id,
      idempotencyKey: 'stage5-reservation-release-transition',
      reason: 'Customer returned to the cart before payment.',
    };

    const released = await service.releaseReservation(transitionInput);
    const replay = await service.releaseReservation(transitionInput);
    const balanceSnapshot = await firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(signatureVariantId)
      .get();

    expect(released.reservation.state).toBe('released');
    expect(released.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(balanceSnapshot.data()).toMatchObject({
      onHand: 40,
      reserved: 0,
      available: 40,
    });
  });

  it('commits a reservation once and records the stock movement', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createInventoryService(firestore);
    const created = await service.createReservation({
      cartId: 'cart-commit-stage5',
      ownerUid: 'customer-commit-stage5',
      guestTokenHash: null,
      lines: [{ variantId: signatureVariantId, quantity: 4 }],
      paymentMethod: 'paystack',
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      idempotencyKey: 'stage5-reservation-commit-create',
    });

    const committed = await service.commitReservation({
      reservationId: created.reservation.id,
      idempotencyKey: 'stage5-reservation-commit-transition',
      reason: 'Paid order confirmed by the payment webhook.',
    });
    const [balanceSnapshot, movementSnapshot] = await Promise.all([
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(signatureVariantId)
        .get(),
      firestore
        .collection(firestoreCollections.inventoryMovements)
        .where('referenceId', '==', created.reservation.id)
        .get(),
    ]);

    expect(committed.reservation.state).toBe('committed');
    expect(balanceSnapshot.data()).toMatchObject({
      onHand: 36,
      reserved: 0,
      available: 36,
    });
    expect(movementSnapshot.size).toBe(1);
    expect(movementSnapshot.docs[0].data()).toMatchObject({
      type: 'reservationCommit',
      quantityEffect: -4,
      referenceType: 'reservation',
    });
  });

  it('expires due reservations and safely returns their stock', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createInventoryService(firestore);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    const created = await service.createReservation({
      cartId: 'cart-expiry-stage5',
      ownerUid: null,
      guestTokenHash: 'a'.repeat(64),
      lines: [{ variantId: signatureVariantId, quantity: 2 }],
      paymentMethod: null,
      expiresAt,
      idempotencyKey: 'stage5-reservation-expiry-create',
    });

    const result = await service.expireDueReservations(
      new Date(expiresAt.getTime() + 60_000),
    );
    const [reservationSnapshot, balanceSnapshot] = await Promise.all([
      firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(created.reservation.id)
        .get(),
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(signatureVariantId)
        .get(),
    ]);

    expect(result.expired).toBe(1);
    expect(reservationSnapshot.get('state')).toBe('expired');
    expect(balanceSnapshot.data()).toMatchObject({
      onHand: 40,
      reserved: 0,
      available: 40,
    });
  });

  it('rejects a reservation idempotency replay with a different owner', async () => {
    const service = createInventoryService(getFirebaseAdminFirestore());
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    const input = {
      cartId: 'cart-owner-replay-stage5',
      ownerUid: 'customer-original-stage5',
      guestTokenHash: null,
      lines: [{ variantId: signatureVariantId, quantity: 1 }],
      paymentMethod: 'paystack' as const,
      expiresAt,
      idempotencyKey: 'stage5-reservation-owner-replay',
    };

    await service.createReservation(input);

    await expect(
      service.createReservation({
        ...input,
        ownerUid: 'customer-forged-stage5',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('initializes and synchronizes inventory with the variant lifecycle', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCatalogueMutationService(firestore);
    const variant = await service.createVariant(
      {
        productId: 'product-signature-pop',
        name: 'Small project pack',
        sku: 'STAGE5-PACK-001',
        skuNormalised: 'STAGE5-PACK-001',
        optionValues: { package: 'Small' },
        packageLabel: 'Small project pack',
        priceKobo: 750_000,
        compareAtPriceKobo: null,
        status: 'active',
        stockManaged: true,
        lowStockThreshold: 4,
        coverageRate: null,
        weightGrams: 10_000,
        publicationOrder: 20,
      },
      catalogueActor,
    );
    const createdBalance = await firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(variant.id)
      .get();

    expect(createdBalance.data()).toMatchObject({
      variantId: variant.id,
      stockManaged: true,
      onHand: 0,
      reserved: 0,
      available: 0,
      lowStockThreshold: 4,
      stockState: 'outOfStock',
      version: 1,
    });

    const updatedVariant = await service.updateVariant(
      {
        variantId: variant.id,
        expectedVersion: 1,
        name: variant.name,
        sku: variant.sku,
        skuNormalised: variant.skuNormalised,
        optionValues: variant.optionValues,
        packageLabel: variant.packageLabel,
        priceKobo: variant.priceKobo,
        compareAtPriceKobo: variant.compareAtPriceKobo,
        status: 'active',
        stockManaged: false,
        lowStockThreshold: 0,
        coverageRate: variant.coverageRate,
        weightGrams: variant.weightGrams,
        publicationOrder: variant.publicationOrder,
      },
      catalogueActor,
    );
    const updatedBalance = await firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(variant.id)
      .get();

    expect(updatedVariant.stockManaged).toBe(false);
    expect(updatedBalance.data()).toMatchObject({
      stockManaged: false,
      stockState: 'notManaged',
      lowStockThreshold: 0,
      version: 2,
    });
  });

  it('cannot disable stock management while a reservation is active', async () => {
    const firestore = getFirebaseAdminFirestore();
    const inventoryService = createInventoryService(firestore);
    const catalogueService = createCatalogueMutationService(firestore);

    await inventoryService.createReservation({
      cartId: 'cart-disable-managed-stage5',
      ownerUid: 'customer-disable-managed-stage5',
      guestTokenHash: null,
      lines: [{ variantId: signatureVariantId, quantity: 1 }],
      paymentMethod: 'paystack',
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      idempotencyKey: 'stage5-reservation-disable-managed',
    });

    await expect(
      catalogueService.updateVariant(
        {
          variantId: signatureVariantId,
          expectedVersion: 1,
          name: 'Standard pack',
          sku: 'FIXTURE-001',
          skuNormalised: 'FIXTURE-001',
          optionValues: { package: 'Standard' },
          packageLabel: 'Fixture pack',
          priceKobo: 1_250_000,
          compareAtPriceKobo: null,
          status: 'active',
          stockManaged: false,
          lowStockThreshold: 5,
          coverageRate: {
            areaSquareMetres: 24,
            perUnits: 1,
            assumptions:
              'Single-coat fixture coverage for deterministic tests.',
            revision: 1,
          },
          weightGrams: 20_000,
          publicationOrder: 10,
        },
        catalogueActor,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});
