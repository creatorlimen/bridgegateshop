import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  CartMutationError,
  createCartService,
} from '@/lib/services/carts/CartService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const signatureVariantId = 'variant-product-signature-pop';
const quickDryVariantId = 'variant-product-quick-dry-pop';
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

describe('Stage 5 authoritative cart application layer', () => {
  it('prices cart lines from Firestore and never trusts a client price', async () => {
    const service = createCartService(getFirebaseAdminFirestore());
    const identity = await service.createGuestCart('a'.repeat(64));

    await service.addItem(identity, signatureVariantId, 2);
    const cart = await service.getCart(identity);

    expect(cart.readyForCheckout).toBe(true);
    expect(cart.subtotalKobo).toBe(2_500_000);
    expect(cart.lines[0]).toMatchObject({
      variantId: signatureVariantId,
      requestedQuantity: 2,
      availableQuantity: 40,
      unitPriceKobo: 1_250_000,
      previousUnitPriceKobo: 1_250_000,
      issues: [],
    });
  });

  it('rejects unavailable stock and explicit quantities above the line limit', async () => {
    const service = createCartService(getFirebaseAdminFirestore());
    const identity = await service.createGuestCart('b'.repeat(64));

    await expect(
      service.addItem(identity, quickDryVariantId, 1),
    ).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
    });

    await service.addItem(identity, signatureVariantId, 2);

    await expect(
      service.addItem(identity, signatureVariantId, 99),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldName: 'quantity',
    });
  });

  it('surfaces price changes until the customer explicitly accepts them', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCartService(firestore);
    const identity = await service.createGuestCart('c'.repeat(64));

    await service.addItem(identity, signatureVariantId, 1);
    await firestore
      .collection(firestoreCollections.productVariants)
      .doc(signatureVariantId)
      .update({
        priceKobo: 1_300_000,
        updatedAt: new Date(),
        updatedBy: 'stage5-price-test',
        version: 2,
      });

    const changedCart = await service.getCart(identity);

    expect(changedCart.readyForCheckout).toBe(false);
    expect(changedCart.lines[0]).toMatchObject({
      unitPriceKobo: 1_300_000,
      previousUnitPriceKobo: 1_250_000,
      issues: ['PRICE_CHANGED'],
    });
    await expect(
      service.validateForCheckout(identity),
    ).rejects.toMatchObject({
      code: 'PRICE_CHANGED',
    });

    await service.acknowledgeCurrentPrices(identity);
    const acceptedCart = await service.validateForCheckout(identity);

    expect(acceptedCart.readyForCheckout).toBe(true);
    expect(acceptedCart.lines[0]).toMatchObject({
      unitPriceKobo: 1_300_000,
      previousUnitPriceKobo: 1_300_000,
      issues: [],
    });
  });

  it('keeps deleted variants visible as unavailable without crashing repricing', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCartService(firestore);
    const identity = await service.createGuestCart('d'.repeat(64));

    await service.addItem(identity, signatureVariantId, 1);
    await firestore
      .collection(firestoreCollections.productVariants)
      .doc(signatureVariantId)
      .delete();

    const cart = await service.getCart(identity);

    expect(cart.lines[0].issues).toContain('UNAVAILABLE');
    await expect(
      service.acknowledgeCurrentPrices(identity),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('merges guest and customer carts once with an ownership-checked replay', async () => {
    const service = createCartService(getFirebaseAdminFirestore());
    const guestIdentity = await service.createGuestCart('e'.repeat(64));
    const customerIdentity = await service.getOrCreateCustomerCart(
      'customer-cart-merge-stage5',
    );

    await service.addItem(guestIdentity, signatureVariantId, 3);
    await service.addItem(customerIdentity, signatureVariantId, 2);

    const merged = await service.mergeGuestCart(
      guestIdentity,
      'customer-cart-merge-stage5',
    );
    const mergedCart = await service.getCart(merged.identity);
    const replay = await service.mergeGuestCart(
      guestIdentity,
      'customer-cart-merge-stage5',
    );

    expect(merged.replay).toBe(false);
    expect(mergedCart.lines[0].requestedQuantity).toBe(5);
    expect(replay).toMatchObject({
      replay: true,
      identity: {
        cartId: merged.identity.cartId,
        ownerUid: 'customer-cart-merge-stage5',
        guestTokenHash: null,
      },
    });

    await expect(
      service.mergeGuestCart(
        {
          ...guestIdentity,
          guestTokenHash: 'f'.repeat(64),
        },
        'customer-cart-merge-stage5',
      ),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('drops unavailable guest lines with a durable merge notice', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCartService(firestore);
    const guestIdentity = await service.createGuestCart('1'.repeat(64));

    await service.addItem(guestIdentity, signatureVariantId, 2);
    await firestore
      .collection(firestoreCollections.productVariants)
      .doc(signatureVariantId)
      .delete();

    const merged = await service.mergeGuestCart(
      guestIdentity,
      'customer-unavailable-merge-stage5',
    );
    const cart = await service.getCart(merged.identity);

    expect(merged.notices).toEqual([
      {
        variantId: signatureVariantId,
        code: 'UNAVAILABLE',
        requestedQuantity: 2,
        acceptedQuantity: 0,
      },
    ]);
    expect(cart.lines).toHaveLength(0);
    expect(cart.mergeNotices).toEqual(merged.notices);
  });

  it('rejects a forged guest-cart token', async () => {
    const service = createCartService(getFirebaseAdminFirestore());
    const identity = await service.createGuestCart('2'.repeat(64));

    await expect(
      service.getCart({
        ...identity,
        guestTokenHash: '3'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(CartMutationError);
  });
});
