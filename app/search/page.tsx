import type { Metadata } from 'next';
import { Search } from 'lucide-react';

import { CatalogueGrid } from '@/app/components/commerce/CatalogueGrid';
import { products } from '@/lib/data/placeholder-catalogue';

export const metadata: Metadata = {
  title: 'Search',
  robots: {
    index: false,
    follow: true,
  },
};

type SearchPageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = resolvedSearchParams.q?.trim() ?? '';
  const normalisedSearchQuery = searchQuery.toLocaleLowerCase();
  const matchingProducts = normalisedSearchQuery
    ? products.filter((product) =>
        [
          product.name,
          product.categoryName,
          product.shortDescription,
          product.description,
        ].some((searchableValue) =>
          searchableValue.toLocaleLowerCase().includes(normalisedSearchQuery),
        ),
      )
    : [];

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
            name="q"
            placeholder="Try “POP paint” or “White Bond”"
            type="search"
          />
          <button className="button-dark min-h-11 px-5" type="submit">
            Search
          </button>
        </form>
      </div>

      {searchQuery ? (
        <div className="mt-14">
          <p className="mb-8 text-sm text-muted">
            {matchingProducts.length} results for{' '}
            <strong className="text-ink">“{searchQuery}”</strong>
          </p>
          <CatalogueGrid products={matchingProducts} />
        </div>
      ) : (
        <p className="mx-auto mt-10 max-w-xl text-center text-sm leading-6 text-muted">
          Search currently covers the active placeholder catalogue. Published
          Knowledge Hub content will join these results in Release 2.
        </p>
      )}
    </div>
  );
}
