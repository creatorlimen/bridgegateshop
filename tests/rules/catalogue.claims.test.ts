import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  CatalogueClaimConflictError,
  reserveSkuClaim,
  reserveSlugClaim,
} from '@/lib/repositories/catalogue/CatalogueClaimRepository';

const projectId = 'demo-bridgegate-shop';
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
});

afterAll(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.cleanup();
});

describe('catalogue uniqueness claims', () => {
  it('permits exactly one winner when two product slugs race', async () => {
    const firestore = getFirebaseAdminFirestore();
    const competingOwnerIds = ['product-race-one', 'product-race-two'];
    const results = await Promise.allSettled(
      competingOwnerIds.map((ownerId) =>
        firestore.runTransaction(async (transaction) => {
          await reserveSlugClaim(transaction, firestore, {
            ownerType: 'product',
            ownerId,
            slug: 'concurrent-product',
            actorId: 'system:claim-test',
          });
          transaction.create(
            firestore.collection(firestoreCollections.products).doc(ownerId),
            {
              slug: 'concurrent-product',
              status: 'draft',
            },
          );
        }),
      ),
    );
    const fulfilledResults = results.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejectedResults = results.filter(
      (result) => result.status === 'rejected',
    );
    const claimSnapshot = await firestore
      .collection(firestoreCollections.slugClaims)
      .doc('product:concurrent-product')
      .get();

    expect(fulfilledResults).toHaveLength(1);
    expect(rejectedResults).toHaveLength(1);
    expect(rejectedResults[0]).toMatchObject({
      reason: expect.any(CatalogueClaimConflictError),
    });
    expect(competingOwnerIds).toContain(claimSnapshot.get('ownerId'));
  });

  it('normalises SKU claims and makes retries by the same owner idempotent', async () => {
    const firestore = getFirebaseAdminFirestore();

    await firestore.runTransaction(async (transaction) => {
      await reserveSkuClaim(transaction, firestore, {
        variantId: 'variant-one',
        sku: 'fixture-unique-001',
        actorId: 'system:claim-test',
      });
    });
    await firestore.runTransaction(async (transaction) => {
      await reserveSkuClaim(transaction, firestore, {
        variantId: 'variant-one',
        sku: 'FIXTURE-UNIQUE-001',
        actorId: 'system:claim-test',
      });
    });

    const claimSnapshot = await firestore
      .collection(firestoreCollections.skuClaims)
      .doc('FIXTURE-UNIQUE-001')
      .get();

    expect(claimSnapshot.get('ownerId')).toBe('variant-one');
  });

  it('rejects a SKU already owned by another variant', async () => {
    const firestore = getFirebaseAdminFirestore();

    await firestore.runTransaction(async (transaction) => {
      await reserveSkuClaim(transaction, firestore, {
        variantId: 'variant-owner',
        sku: 'FIXTURE-CONFLICT-001',
        actorId: 'system:claim-test',
      });
    });

    await expect(
      firestore.runTransaction(async (transaction) => {
        await reserveSkuClaim(transaction, firestore, {
          variantId: 'variant-competitor',
          sku: 'FIXTURE-CONFLICT-001',
          actorId: 'system:claim-test',
        });
      }),
    ).rejects.toBeInstanceOf(CatalogueClaimConflictError);
  });
});
