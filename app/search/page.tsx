import type { Metadata } from 'next';
import { Search } from 'lucide-react';

import { CatalogueGrid } from '@/app/components/commerce/CatalogueGrid';
import { getPublicCatalogue } from '@/lib/services/catalogue/publicCatalogue';

export const metadata: Metadata = {
  title: 'Search',
  robots: {
    index: false,
    follow: true,
  },
};

export const revalidate = 300;

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = resolvedSearchParams.q?.trim() ?? '';
  const catalogue = searchQuery
    ? await getPublicCatalogue({ query: searchQuery, pageSize: 30 })
    : null;

  return (
    <div className="shell py-12 sm:py-16">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow justify-center text-clay">Search</p>
        <h1 className="display-type mt-5 text-5xl sm:text-6xl">
          Find the right material.
        </h1>
        <form
          className="mt-8 flex min-h-16 items-center gap-3 rounded-full border border-ink/15 bg-paper px-5 shadow-card"
          action="/search"
        >
          <Search aria-hidden="true" className="text-muted" size={20} />
          <label className="sr-only" htmlFor="site-search">
            Search the catalogue
          </label>
          <input
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
            defaultValue={searchQuery}
            id="site-search"
            minLength={2}
            name="q"
            placeholder="Try “POP paint” or “White Bond”"
            type="search"
          />
          <button className="button-dark min-h-11 px-5" type="submit">
            Search
          </button>
        </form>
      </div>

      {searchQuery && catalogue ? (
        <div className="mt-14">
          <p className="mb-8 text-sm text-muted">
            {catalogue.products.length} results for{' '}
            <strong className="text-ink">“{searchQuery}”</strong>
          </p>
          <CatalogueGrid products={catalogue.products} />
        </div>
      ) : (
        <p className="mx-auto mt-10 max-w-xl text-center text-sm leading-6 text-muted">
          Search covers active catalogue products. Published Knowledge Hub
          content joins these results in Release 2.
        </p>
      )}
    </div>
  );
}
