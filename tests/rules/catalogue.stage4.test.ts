import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { createCatalogueSearchRepository } from '@/lib/repositories/catalogue/CatalogueSearchRepository';
import {
  CatalogueMutationError,
  createCatalogueMutationService,
  type CatalogueMutationActor,
} from '@/lib/services/catalogue/CatalogueMutationService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const ownerActor: CatalogueMutationActor = {
  actorId: 'stage4-owner',
  roleIds: ['owner'],
  requestId: 'request-stage4-owner',
};
const administratorActor: CatalogueMutationActor = {
  actorId: 'stage4-administrator',
  roleIds: ['administrator'],
  requestId: 'request-stage4-administrator',
};
const emptySeo = {
  title: null,
  description: null,
  canonicalUrl: null,
  socialMediaId: null,
};
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

describe('Stage 4 catalogue application layer', () => {
  it('creates and activates an audited category with a unique slug claim', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCatalogueMutationService(firestore);
    const category = await service.createCategory(
      {
        name: 'Primers',
        slug: 'primers',
        description: 'Prepared-surface primer products.',
        displayOrder: 30,
        imageMediaId: null,
        seo: emptySeo,
        searchKeywords: ['primer', 'surface'],
      },
      ownerActor,
    );
    const activatedCategory = await service.activateCategory(
      {
        categoryId: category.id,
        expectedVersion: category.version,
      },
      ownerActor,
    );
    const [claimSnapshot, auditSnapshot] = await Promise.all([
      firestore
        .collection(firestoreCollections.slugClaims)
        .doc('category:primers')
        .get(),
      firestore
        .collection(firestoreCollections.auditEvents)
        .where('entityId', '==', category.id)
        .get(),
    ]);

    expect(category.status).toBe('draft');
    expect(activatedCategory.status).toBe('active');
    expect(activatedCategory.version).toBe(2);
    expect(claimSnapshot.get('ownerId')).toBe(category.id);
    expect(auditSnapshot.size).toBe(2);
  });

  it('allows exactly one winner when category creation races for a slug', async () => {
    const service = createCatalogueMutationService(
      getFirebaseAdminFirestore(),
    );
    const results = await Promise.allSettled(
      ['First', 'Second'].map((name) =>
        service.createCategory(
          {
            name,
            slug: 'race-category',
            description: `${name} concurrent category.`,
            displayOrder: 40,
            imageMediaId: null,
            seo: emptySeo,
            searchKeywords: ['race'],
          },
          ownerActor,
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('enforces the normal media gate and permits an audited owner override', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCatalogueMutationService(firestore);

    await expect(
      service.publishProduct(
        {
          productId: 'product-signature-pop',
          expectedVersion: 1,
          mediaOverrideReason: null,
        },
        administratorActor,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });

    const publishedProduct = await service.publishProduct(
      {
        productId: 'product-signature-pop',
        expectedVersion: 1,
        mediaOverrideReason:
          'Approved launch exception while final photography is pending.',
      },
      ownerActor,
    );
    const searchDocument = await firestore
      .collection(firestoreCollections.searchDocuments)
      .doc('product:product-signature-pop')
      .get();

    expect(publishedProduct.status).toBe('active');
    expect(publishedProduct.version).toBe(2);
    expect(searchDocument.get('title')).toBe('Signature POP Paint');
  });

  it('archives a product, removes its search projection, and rejects stale versions', async () => {
    const firestore = getFirebaseAdminFirestore();
    const service = createCatalogueMutationService(firestore);
    const archivedProduct = await service.archiveProduct(
      {
        productId: 'product-signature-pop',
        expectedVersion: 1,
        reason: 'Product withdrawn from the active launch assortment.',
      },
      ownerActor,
    );
    const searchDocument = await firestore
      .collection(firestoreCollections.searchDocuments)
      .doc('product:product-signature-pop')
      .get();

    expect(archivedProduct.status).toBe('archived');
    expect(searchDocument.exists).toBe(false);

    await expect(
      service.archiveProduct(
        {
          productId: 'product-signature-pop',
          expectedVersion: 1,
          reason: 'Stale repeat request.',
        },
        ownerActor,
      ),
    ).rejects.toBeInstanceOf(CatalogueMutationError);
  });

  it('searches active projections by exact terms and prefixes', async () => {
    const searchRepository = createCatalogueSearchRepository(
      getFirebaseAdminFirestore(),
    );
    const exactResults =
      await searchRepository.searchActiveProducts('white bond');
    const prefixResults =
      await searchRepository.searchActiveProducts('sign');

    expect(exactResults).toHaveLength(5);
    expect(exactResults.every((result) => result.type === 'product')).toBe(
      true,
    );
    expect(prefixResults[0].slug).toBe('signature-pop-paint');
  });
});
