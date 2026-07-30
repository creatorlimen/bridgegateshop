import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  CatalogueDataError,
  CatalogueQueryError,
  createCatalogueRepository,
  type CatalogueRepository,
} from '@/lib/repositories/catalogue/CatalogueRepository';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
let catalogueRepository: CatalogueRepository;
let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  const firestoreRules = await readFile(
    path.join(process.cwd(), 'firestore.rules'),
    'utf8',
  );

  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: firestoreRules,
    },
  });
  catalogueRepository = createCatalogueRepository(
    getFirebaseAdminFirestore(),
  );
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedCatalogue(getFirebaseAdminFirestore());
});

afterAll(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.cleanup();
});

describe('Firestore catalogue repository', () => {
  it('maps active categories in deterministic display order', async () => {
    const categories = await catalogueRepository.listActiveCategories();

    expect(categories.map((category) => category.slug)).toEqual([
      'pop-paint',
      'white-bond',
    ]);
    expect(firestoreTimestampToDate(categories[0].createdAt)).toEqual(
      new Date('2026-01-15T09:00:00.000Z'),
    );
  });

  it('paginates all ten active products without duplicates', async () => {
    const firstPage = await catalogueRepository.listActiveProducts({
      pageSize: 4,
    });
    const secondPage = await catalogueRepository.listActiveProducts({
      cursor: firstPage.nextCursor ?? undefined,
      pageSize: 4,
    });
    const thirdPage = await catalogueRepository.listActiveProducts({
      cursor: secondPage.nextCursor ?? undefined,
      pageSize: 4,
    });
    const productIds = [
      ...firstPage.products,
      ...secondPage.products,
      ...thirdPage.products,
    ].map((product) => product.id);

    expect(productIds).toHaveLength(10);
    expect(new Set(productIds)).toHaveLength(10);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.nextCursor).not.toBeNull();
    expect(thirdPage.nextCursor).toBeNull();
  });

  it('filters active products by category and resolves related records', async () => {
    const category =
      await catalogueRepository.findActiveCategoryBySlug('white-bond');

    expect(category).not.toBeNull();

    const productPage = await catalogueRepository.listActiveProducts({
      categoryId: category?.id,
      pageSize: 10,
    });
    const product =
      await catalogueRepository.findActiveProductBySlug('white-bond-standard');
    const variants = await catalogueRepository.listActiveVariantsForProduct(
      product?.id ?? '',
    );
    const media = await catalogueRepository.findReadyProductMediaById(
      product?.primaryMediaId ?? '',
    );

    expect(productPage.products).toHaveLength(5);
    expect(product?.categoryId).toBe('category-white-bond');
    expect(variants).toHaveLength(1);
    expect(variants[0].skuNormalised).toBe('FIXTURE-006');
    expect(media?.processingState).toBe('ready');
  });

  it('rejects unsafe IDs and forged pagination cursors', async () => {
    await expect(
      catalogueRepository.listActiveProducts({
        categoryId: '../categories',
      }),
    ).rejects.toBeInstanceOf(CatalogueQueryError);
    await expect(
      catalogueRepository.listActiveProducts({
        cursor: 'not-a-valid-cursor',
      }),
    ).rejects.toBeInstanceOf(CatalogueQueryError);
  });

  it('fails closed when a stored product does not match its schema', async () => {
    await getFirebaseAdminFirestore()
      .collection(firestoreCollections.products)
      .doc('invalid-product')
      .set({
        slug: 'invalid-product',
        status: 'active',
      });

    await expect(
      catalogueRepository.findActiveProductBySlug('invalid-product'),
    ).rejects.toBeInstanceOf(CatalogueDataError);
  });

  it('denies catalogue access through customer and staff client SDKs', async () => {
    const customerFirestore = testEnvironment
      .authenticatedContext('customer-1', {
        email: 'customer@example.com',
      })
      .firestore();
    const staffFirestore = testEnvironment
      .authenticatedContext('staff-1', {
        email: 'staff@example.com',
      })
      .firestore();

    await assertFails(
      getDoc(
        doc(
          customerFirestore,
          `${firestoreCollections.products}/product-signature-pop`,
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          staffFirestore,
          `${firestoreCollections.categories}/category-pop-paint`,
        ),
      ),
    );
  });
});
