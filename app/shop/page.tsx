import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import Link from 'next/link';

import { CatalogueGrid } from '@/app/components/commerce/CatalogueGrid';
import { getPublicCatalogue } from '@/lib/services/catalogue/publicCatalogue';
import { cn } from '@/lib/utils/cn';

export const metadata: Metadata = {
  title: 'Shop building finishes',
  description:
    'Browse published building finishes, pack sizes, current prices, and availability.',
};

export const revalidate = 300;

type ShopPageProps = {
  searchParams: Promise<{
    category?: string;
    q?: string;
    cursor?: string;
  }>;
};

function getShopHref({
  category,
  query,
  cursor,
}: {
  category?: string;
  query?: string;
  cursor?: string;
}) {
  const searchParameters = new URLSearchParams();

  if (category && category !== 'all') {
    searchParameters.set('category', category);
  }

  if (query) {
    searchParameters.set('q', query);
  }

  if (cursor) {
    searchParameters.set('cursor', cursor);
  }

  const queryString = searchParameters.toString();
  return queryString ? `/shop?${queryString}` : '/shop';
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const resolvedSearchParams = await searchParams;
  const activeCategory = resolvedSearchParams.category ?? 'all';
  const searchQuery = resolvedSearchParams.q?.trim() ?? '';
  const catalogue = await getPublicCatalogue({
    categorySlug:
      activeCategory === 'all' ? undefined : activeCategory,
    query: searchQuery,
    cursor: resolvedSearchParams.cursor,
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
            Compare pack sizes and current availability. Prices and
            eligibility are revalidated by the server before checkout.
          </p>
          {catalogue.dataSource === 'placeholder' ? (
            <p className="mt-4 inline-flex rounded-full bg-amber/20 px-3 py-2 text-xs font-black text-clay">
              Preview catalogue · commercial data awaits approval
            </p>
          ) : null}
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
            defaultValue={searchQuery}
            id="catalogue-search"
            minLength={2}
            name="q"
            placeholder="Search products"
            type="search"
          />
          {activeCategory !== 'all' ? (
            <input
              name="category"
              type="hidden"
              value={activeCategory}
            />
          ) : null}
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
              href={getShopHref({ query: searchQuery })}
            >
              All materials
            </Link>
            {catalogue.categories.map((category) => (
              <Link
                className={cn(
                  'whitespace-nowrap rounded-full px-4 py-3 text-sm font-extrabold lg:rounded-xl',
                  activeCategory === category.slug
                    ? 'bg-ink text-white'
                    : 'bg-paper hover:bg-ink/5',
                )}
                href={getShopHref({
                  category: category.slug,
                  query: searchQuery,
                })}
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
              <strong className="text-ink">
                {catalogue.products.length}
              </strong>{' '}
              {catalogue.products.length === 1 ? 'product' : 'products'}
            </p>
            <p className="text-xs font-bold text-muted">Prices in NGN</p>
          </div>
          <CatalogueGrid products={catalogue.products} />
          {catalogue.nextCursor ? (
            <div className="mt-12 flex justify-center">
              <Link
                className="button-dark"
                href={getShopHref({
                  category: activeCategory,
                  query: searchQuery,
                  cursor: catalogue.nextCursor,
                })}
              >
                Next products
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
