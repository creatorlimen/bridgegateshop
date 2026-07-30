import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CatalogueGrid } from '@/app/components/commerce/CatalogueGrid';
import {
  getCategoryBySlug,
  productCategories,
  products,
} from '@/lib/data/placeholder-catalogue';

type CategoryPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return productCategories.map((category) => ({
    slug: category.slug,
  }));
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  return {
    title: category?.name ?? 'Product category',
    description: category?.description,
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  const categoryProducts = products.filter(
    (product) => product.categoryId === category.id,
  );

  return (
    <div className="shell py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow text-clay">Shop category</p>
        <h1 className="display-type mt-5 text-balance text-5xl leading-none sm:text-6xl">
          {category.name}
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          {category.description}
        </p>
      </div>
      <div className="mt-12">
        <CatalogueGrid products={categoryProducts} />
      </div>
    </div>
  );
}
