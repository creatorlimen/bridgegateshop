import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import Link from 'next/link';

import { CatalogueGrid } from '@/app/components/commerce/CatalogueGrid';
import {
  productCategories,
  products,
} from '@/lib/data/placeholder-catalogue';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = {
  title: 'Shop building finishes',
  description:
    'Browse placeholder POP Paint and White Bond products for the BridgegateShop launch catalogue.',
};

type ShopPageProps = {
  searchParams: Promise<{
    category?: string;
    q?: string;
  }>;
};

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const resolvedSearchParams = await searchParams;
  const normalisedQuery =
    resolvedSearchParams.q?.trim().toLocaleLowerCase() ?? '';
  const activeCategory = resolvedSearchParams.category ?? 'all';
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      activeCategory === 'all' ||
      product.categoryId ===
        productCategories.find(
          (category) => category.slug === activeCategory,
        )?.id;
    const matchesSearch =
      !normalisedQuery ||
      [product.name, product.categoryName, product.shortDescription].some(
        (searchableValue) =>
          searchableValue.toLocaleLowerCase().includes(normalisedQuery),
      );

    return matchesCategory && matchesSearch;
  });

  return (
    <div className="shell py-12 sm:py-16">
      <div className="grid gap-8 border-b border-ink/10 pb-10 lg:grid-cols-[1fr_24rem] lg:items-end">
        <div>
          <p className="eyebrow text-clay">The catalogue</p>
          <h1 className="display-type mt-5 max-w-3xl text-balance text-5xl leading-[0.98] sm:text-6xl">
            Materials selected for the finishing work.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
            Compare pack sizes and availability. All current prices are
            placeholders and will be revalidated by the future commerce
            service before checkout.
          </p>
        </div>
        <form
          className="flex min-h-14 items-center gap-3 rounded-full border border-ink/15 bg-paper px-5"
          action="/shop"
        >
          <Search aria-hidden="true" className="text-muted" size={19} />
          <label className="sr-only" htmlFor="catalogue-search">
            Search products
          </label>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
            defaultValue={resolvedSearchParams.q}
            id="catalogue-search"
            name="q"
            placeholder="Search products"
            type="search"
          />
          <button
            className="rounded-full bg-ink px-4 py-2 text-xs font-black text-white"
            type="submit"
          >
            Search
          </button>
        </form>
      </div>

      <div className="grid gap-10 pt-10 lg:grid-cols-[13rem_1fr]">
        <aside>
          <h2 className="text-xs font-black uppercase tracking-[0.16em] text-muted">
            Categories
          </h2>
          <nav
            className="mt-4 flex gap-2 overflow-x-auto pb-2 lg:grid"
            aria-label="Product categories"
          >
            <Link
              className={cn(
                'whitespace-nowrap rounded-full px-4 py-3 text-sm font-extrabold lg:rounded-xl',
                activeCategory === 'all'
                  ? 'bg-ink text-white'
                  : 'bg-paper hover:bg-ink/5',
              )}
              href="/shop"
            >
              All materials
            </Link>
            {productCategories.map((category) => (
              <Link
                className={cn(
                  'whitespace-nowrap rounded-full px-4 py-3 text-sm font-extrabold lg:rounded-xl',
                  activeCategory === category.slug
                    ? 'bg-ink text-white'
                    : 'bg-paper hover:bg-ink/5',
                )}
                href={`/shop?category=${category.slug}`}
                key={category.id}
              >
                {category.name}
              </Link>
            ))}
          </nav>
          <div className="mt-8 hidden rounded-2xl bg-amber/20 p-5 lg:block">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-clay">
              Buying in volume?
            </p>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              Send quantities and project timing through the structured quote
              workflow.
            </p>
            <Link
              className="mt-4 inline-flex text-sm font-black underline underline-offset-4"
              href="/bulk-quote"
            >
              Request a quote
            </Link>
          </div>
        </aside>

        <div>
          <div className="mb-8 flex items-center justify-between gap-4">
            <p className="text-sm text-muted">
              <strong className="text-ink">{filteredProducts.length}</strong>{' '}
              {filteredProducts.length === 1 ? 'product' : 'products'}
            </p>
            <p className="text-xs font-bold text-muted">Prices in NGN</p>
          </div>
          <CatalogueGrid products={filteredProducts} />
        </div>
      </div>
    </div>
  );
}
