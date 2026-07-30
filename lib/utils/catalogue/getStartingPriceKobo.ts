import type { Product } from '@/lib/types/catalogue';

export function getStartingPriceKobo(product: Product) {
  return Math.min(
    ...product.variants.map((variant) => variant.priceKobo),
  );
}
