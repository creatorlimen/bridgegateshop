import { describe, expect, it } from 'vitest';

import {
  catalogueSlugSchema,
  categoryDocumentSchema,
  productDocumentSchema,
  productMediaDocumentSchema,
  productVariantDocumentSchema,
} from '@/lib/schemas/catalogue';
import { firestoreDocumentIdSchema } from '@/lib/schemas/common';
import { catalogueSeedFixture } from '@/tests/fixtures/catalogue';

describe('catalogue schemas', () => {
  it('accepts the deterministic Stage 3 catalogue fixture', () => {
    expect(catalogueSeedFixture.products).toHaveLength(10);

    for (const category of catalogueSeedFixture.categories) {
      expect(categoryDocumentSchema.safeParse(category.data).success).toBe(
        true,
      );
    }

    for (const product of catalogueSeedFixture.products) {
      expect(productDocumentSchema.safeParse(product.data).success).toBe(true);
    }

    for (const variant of catalogueSeedFixture.variants) {
      expect(productVariantDocumentSchema.safeParse(variant.data).success).toBe(
        true,
      );
    }

    for (const media of catalogueSeedFixture.media) {
      expect(productMediaDocumentSchema.safeParse(media.data).success).toBe(
        true,
      );
    }
  });

  it('rejects a published product without publication evidence', () => {
    const product = catalogueSeedFixture.products[0].data;
    const result = productDocumentSchema.safeParse({
      ...product,
      primaryMediaId: null,
      publishedAt: null,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an inverted price range', () => {
    const product = catalogueSeedFixture.products[0].data;
    const result = productDocumentSchema.safeParse({
      ...product,
      priceSummary: {
        ...product.priceSummary,
        minimumPriceKobo: product.priceSummary.maximumPriceKobo + 1,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects compare-at prices that are not greater than the active price', () => {
    const variant = catalogueSeedFixture.variants[0].data;
    const result = productVariantDocumentSchema.safeParse({
      ...variant,
      compareAtPriceKobo: variant.priceKobo,
    });

    expect(result.success).toBe(false);
  });

  it('rejects path-like IDs and non-canonical slugs', () => {
    expect(firestoreDocumentIdSchema.safeParse('../products').success).toBe(
      false,
    );
    expect(catalogueSlugSchema.safeParse('POP Paint').success).toBe(false);
    expect(catalogueSlugSchema.safeParse('pop-paint').success).toBe(true);
  });
});
