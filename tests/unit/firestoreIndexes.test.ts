import { describe, expect, it } from 'vitest';

import firestoreIndexes from '@/firestore.indexes.json';

function indexSignature(index: (typeof firestoreIndexes.indexes)[number]) {
  return [
    index.collectionGroup,
    ...index.fields.map(
      (field) => `${field.fieldPath}:${field.order.toLowerCase()}`,
    ),
  ].join('|');
}

describe('Firestore index manifest', () => {
  it('contains every declared composite index used by server repositories', () => {
    const indexSignatures = new Set(
      firestoreIndexes.indexes.map(indexSignature),
    );

    expect(indexSignatures).toEqual(
      new Set([
        'categories|status:ascending|displayOrder:ascending|name:ascending',
        'products|status:ascending|publicationOrder:ascending|name:ascending',
        'products|categoryId:ascending|status:ascending|publicationOrder:ascending|name:ascending',
        'productVariants|productId:ascending|status:ascending|publicationOrder:ascending|name:ascending',
        'inventoryBalances|stockState:ascending|lastMovementAt:descending',
        'inventoryReservations|state:ascending|expiresAt:ascending',
        'carts|ownerUid:ascending|status:ascending',
        'orders|ownerUid:ascending|placedAt:descending',
        'financialDocuments|ownerUid:ascending|issuedAt:descending',
        'outboxEvents|eventName:ascending|state:ascending|nextAttemptAt:ascending',
        'deliveries|status:ascending|estimate.latestDate:ascending',
      ]),
    );
  });
});
