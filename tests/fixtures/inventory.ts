import type { InventoryBalanceDocument } from '@/lib/schemas/inventory';
import {
  productSeedRecords,
  variantSeedRecords,
} from '@/tests/fixtures/catalogue';

type SeedRecord<DocumentType> = {
  id: string;
  data: DocumentType;
};

const seedActor = 'system:test-seed';
const seedTimestamp = new Date('2026-01-15T09:00:00.000Z');

export const inventoryBalanceSeedRecords: SeedRecord<InventoryBalanceDocument>[] =
  variantSeedRecords.map((variant) => {
    const product = productSeedRecords.find(
      (candidate) => candidate.id === variant.data.productId,
    );

    if (!product) {
      throw new Error('Fixture variant product is missing.');
    }

    const onHand =
      product.data.availabilitySummary.stockState === 'outOfStock'
        ? 0
        : product.data.availabilitySummary.stockState === 'lowStock'
          ? 3
          : 40;

    return {
      id: variant.id,
      data: {
        schemaVersion: 1,
        variantId: variant.id,
        stockManaged: true,
        onHand,
        reserved: 0,
        available: onHand,
        lowStockThreshold: variant.data.lowStockThreshold,
        stockState: product.data.availabilitySummary.stockState,
        lastMovementAt: seedTimestamp,
        createdAt: seedTimestamp,
        createdBy: seedActor,
        updatedAt: seedTimestamp,
        updatedBy: seedActor,
        version: 1,
      },
    };
  });
