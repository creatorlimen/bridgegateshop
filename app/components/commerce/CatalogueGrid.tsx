import { ProductCard } from '@/app/components/commerce/ProductCard';
import type { Product } from '@/lib/types/catalogue';

type CatalogueGridProps = {
  products: Product[];
};

export function CatalogueGrid({
  products: catalogueProducts,
}: CatalogueGridProps) {
  if (catalogueProducts.length === 0) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-ink/25 bg-paper p-10 text-center">
        <h2 className="text-xl font-black">No matching materials yet</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          Try another category or search term. The placeholder catalogue will
          expand when approved product data arrives.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3">
      {catalogueProducts.map((product) => (
        <ProductCard product={product} key={product.id} />
      ))}
    </div>
  );
}
