import type { Firestore } from 'firebase-admin/firestore';

import { firestoreCollections } from '@/lib/firebase/collections';
import { catalogueSeedFixture } from '@/tests/fixtures/catalogue';

export async function seedCatalogue(firestore: Firestore) {
  const writeBatch = firestore.batch();

  for (const category of catalogueSeedFixture.categories) {
    writeBatch.set(
      firestore
        .collection(firestoreCollections.categories)
        .doc(category.id),
      category.data,
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
