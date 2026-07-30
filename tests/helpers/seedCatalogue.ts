import type { Firestore } from 'firebase-admin/firestore';

import { firestoreCollections } from '@/lib/firebase/collections';
import { catalogueSeedFixture } from '@/tests/fixtures/catalogue';
import { inventoryBalanceSeedRecords } from '@/tests/fixtures/inventory';
import { createSearchTokenProjection } from '@/lib/utils/catalogue/searchTokens';

export async function seedCatalogue(firestore: Firestore) {
  const writeBatch = firestore.batch();

  for (const category of catalogueSeedFixture.categories) {
    writeBatch.set(
      firestore
        .collection(firestoreCollections.categories)
        .doc(category.id),
      category.data,
    );
    writeBatch.set(
      firestore
        .collection(firestoreCollections.slugClaims)
        .doc(`category:${category.data.slug}`),
      {
        schemaVersion: 1,
        ownerId: category.id,
        ownerType: 'category',
        claimedAt: category.data.createdAt,
        claimedBy: category.data.createdBy,
      },
    );
  }

  for (const product of catalogueSeedFixture.products) {
    writeBatch.set(
      firestore.collection(firestoreCollections.products).doc(product.id),
      product.data,
    );
    writeBatch.set(
      firestore
        .collection(firestoreCollections.slugClaims)
        .doc(`product:${product.data.slug}`),
      {
        schemaVersion: 1,
        ownerId: product.id,
        ownerType: 'product',
        claimedAt: product.data.createdAt,
        claimedBy: product.data.createdBy,
      },
    );
    const category = catalogueSeedFixture.categories.find(
      (categoryRecord) => categoryRecord.id === product.data.categoryId,
    );

    if (!category) {
      throw new Error('Fixture product category is missing.');
    }

    const tokenProjection = createSearchTokenProjection([
      product.data.name,
      product.data.shortDescription,
      product.data.description,
      category.data.name,
      ...category.data.searchKeywords,
      ...product.data.searchKeywords,
    ]);
    const imageMediaId = product.data.primaryMediaId;

    if (!imageMediaId) {
      throw new Error('Published fixture product media is missing.');
    }

    writeBatch.set(
      firestore
        .collection(firestoreCollections.searchDocuments)
        .doc(`product:${product.id}`),
      {
        schemaVersion: 1,
        type: 'product',
        productId: product.id,
        title: product.data.name,
        slug: product.data.slug,
        excerpt: product.data.shortDescription,
        categoryId: product.data.categoryId,
        imageMediaId,
        minimumPriceKobo: product.data.priceSummary.minimumPriceKobo,
        maximumPriceKobo: product.data.priceSummary.maximumPriceKobo,
        currency: 'NGN',
        stockState: product.data.availabilitySummary.stockState,
        exactTokens: tokenProjection.exactTokens,
        searchTokens: tokenProjection.searchTokens,
        updatedAt: product.data.updatedAt,
      },
    );
  }

  for (const variant of catalogueSeedFixture.variants) {
    writeBatch.set(
      firestore
        .collection(firestoreCollections.productVariants)
        .doc(variant.id),
      variant.data,
    );
    writeBatch.set(
      firestore
        .collection(firestoreCollections.skuClaims)
        .doc(variant.data.skuNormalised),
      {
        schemaVersion: 1,
        ownerId: variant.id,
        claimedAt: variant.data.createdAt,
        claimedBy: variant.data.createdBy,
      },
    );
  }

  for (const balance of inventoryBalanceSeedRecords) {
    writeBatch.set(
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(balance.id),
      balance.data,
    );
  }

  for (const media of catalogueSeedFixture.media) {
    writeBatch.set(
      firestore
        .collection(firestoreCollections.productMedia)
        .doc(media.id),
      media.data,
    );
  }

  await writeBatch.commit();
}
