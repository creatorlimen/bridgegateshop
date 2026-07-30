import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { CatalogueGrid } from '@/app/components/commerce/CatalogueGrid';
import { getPublicCategory } from '@/lib/services/catalogue/publicCatalogue';
import { resolveCatalogueRedirect } from '@/lib/services/catalogue/resolveCatalogueRedirect';

export const revalidate = 300;

type CategoryPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const categoryResult = await getPublicCategory(slug);
  const category = categoryResult?.category;

  return {
    title: category?.seo?.title ?? category?.name ?? 'Product category',
    description:
      category?.seo?.description ?? category?.description,
    alternates: category?.seo?.canonicalUrl
      ? { canonical: category.seo.canonicalUrl }
      : undefined,
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const categoryResult = await getPublicCategory(slug);

  if (!categoryResult) {
    const redirectSlug = await resolveCatalogueRedirect('category', slug);

    if (redirectSlug) {
      permanentRedirect(`/shop/category/${redirectSlug}`);
    }

    notFound();
  }

  return (
    <div className="shell py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow text-clay">Shop category</p>
        <h1 className="display-type mt-5 text-balance text-5xl leading-none sm:text-6xl">
          {categoryResult.category.name}
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          {categoryResult.category.description}
        </p>
      </div>
      <div className="mt-12">
        <CatalogueGrid products={categoryResult.products} />
      </div>
    </div>
  );
}
