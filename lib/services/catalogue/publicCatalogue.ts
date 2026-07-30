import 'server-only';

import { z } from 'zod';

import { getCatalogueDataSource } from '@/lib/config/catalogueDataSource';
import {
  productCategories as placeholderCategories,
  products as placeholderProducts,
} from '@/lib/data/placeholder-catalogue';
import {
  createCatalogueRepository,
  type CatalogueRepository,
} from '@/lib/repositories/catalogue/CatalogueRepository';
import {
  createCatalogueSearchRepository,
  type CatalogueSearchRepository,
} from '@/lib/repositories/catalogue/CatalogueSearchRepository';
import type {
  CategoryRecord,
  ProductMediaRecord,
  ProductRecord,
  ProductVariantRecord,
} from '@/lib/schemas/catalogue';
import type {
  Product,
  ProductCategory,
  StockState,
} from '@/lib/types/catalogue';
import { normaliseSearchText } from '@/lib/utils/catalogue/searchTokens';

const publicQuerySchema = z.string().trim().max(120);
const publicCursorSchema = z.string().trim().min(1).max(1_024);

export type PublicCataloguePage = {
  categories: ProductCategory[];
  products: Product[];
  nextCursor: string | null;
  dataSource: 'placeholder' | 'firestore';
};

type GetPublicCatalogueInput = {
  categorySlug?: string;
  query?: string;
  cursor?: string;
  pageSize?: number;
};

function getPlaceholderImage(categorySlug: string) {
  return categorySlug === 'white-bond'
    ? '/images/white-bond-placeholder.png'
    : '/images/pop-paint-placeholder.png';
}

function toPublicCategory(category: CategoryRecord): ProductCategory {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    seo: {
      title: category.seo.title ?? undefined,
      description: category.seo.description ?? undefined,
      canonicalUrl: category.seo.canonicalUrl ?? undefined,
    },
  };
}

function toPublicStockState(
  stockState: ProductRecord['availabilitySummary']['stockState'],
): StockState {
  return stockState === 'notManaged' ? 'inStock' : stockState;
}

function getMediaRoute(
  media: ProductMediaRecord | undefined,
  kind: 'card' | 'detail' | 'social',
) {
  return media
    ? `/api/media/catalogue/${media.id}?kind=${kind}`
    : null;
}

function mapVariant(
  variant: ProductVariantRecord,
  stockState: StockState,
) {
  return {
    id: variant.id,
    name: variant.name,
    sku: variant.sku,
    packageLabel: variant.packageLabel,
    priceKobo: variant.priceKobo,
    compareAtPriceKobo: variant.compareAtPriceKobo ?? undefined,
    stockState,
    coverageSquareMetres: variant.coverageRate
      ? variant.coverageRate.areaSquareMetres /
        variant.coverageRate.perUnits
      : undefined,
  };
}

async function mapFirestoreProduct(
  product: ProductRecord,
  category: CategoryRecord,
  repository: CatalogueRepository,
): Promise<Product | null> {
  const [variants, media] = await Promise.all([
    repository.listActiveVariantsForProduct(product.id),
    repository.listReadyProductMediaForProduct(product.id),
  ]);

  if (variants.length === 0) {
    return null;
  }

  const primaryMedia = media.find(
    (mediaItem) => mediaItem.id === product.primaryMediaId,
  );
  const socialMedia = media.find(
    (mediaItem) => mediaItem.id === product.seo.socialMediaId,
  );
  const orderedMedia = primaryMedia
    ? [primaryMedia, ...media.filter((item) => item.id !== primaryMedia.id)]
    : media;
  const stockState = toPublicStockState(
    product.availabilitySummary.stockState,
  );

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    categoryId: category.id,
    categoryName: category.name,
    shortDescription: product.shortDescription,
    description: product.description,
    imagePath:
      getMediaRoute(primaryMedia, 'card') ??
      getPlaceholderImage(category.slug),
    detailImagePath:
      getMediaRoute(primaryMedia, 'detail') ??
      getPlaceholderImage(category.slug),
    imageAlt:
      primaryMedia?.altText ??
      `${product.name} placeholder product image`,
    galleryImages: orderedMedia.map((mediaItem) => ({
      id: mediaItem.id,
      path:
        getMediaRoute(mediaItem, 'detail') ??
        getPlaceholderImage(category.slug),
      alt: mediaItem.altText,
    })),
    status:
      product.status === 'outOfStock' ? 'outOfStock' : 'active',
    badge: product.badge ?? undefined,
    featured: product.featured,
    variants: variants.map((variant) =>
      mapVariant(variant, stockState),
    ),
    specifications: product.specifications,
    usageGuidance: product.usageGuidance,
    seo: {
      title: product.seo.title ?? undefined,
      description: product.seo.description ?? undefined,
      canonicalUrl: product.seo.canonicalUrl ?? undefined,
      imagePath:
        getMediaRoute(socialMedia, 'social') ??
        getMediaRoute(primaryMedia, 'social') ??
        undefined,
    },
  };
}

function filterPlaceholderProducts(
  categorySlug: string | undefined,
  query: string,
) {
  const category = categorySlug
    ? placeholderCategories.find(
        (categoryItem) => categoryItem.slug === categorySlug,
      )
    : undefined;
  const normalisedQuery = normaliseSearchText(query);

  return placeholderProducts.filter((product) => {
    const matchesCategory =
      !categorySlug || product.categoryId === category?.id;
    const matchesQuery =
      !normalisedQuery ||
      [
        product.name,
        product.categoryName,
        product.shortDescription,
        product.description,
      ].some((value) =>
        normaliseSearchText(value).includes(normalisedQuery),
      );

    return matchesCategory && matchesQuery;
  });
}

async function mapFirestoreProducts(
  products: readonly ProductRecord[],
  categories: readonly CategoryRecord[],
  repository: CatalogueRepository,
) {
  const categoriesById = new Map(
    categories.map((category) => [category.id, category]),
  );
  const mappedProducts = await Promise.all(
    products.map(async (product) => {
      const category =
        categoriesById.get(product.categoryId) ??
        (await repository.findActiveCategoryById(product.categoryId));

      return category
        ? mapFirestoreProduct(product, category, repository)
        : null;
    }),
  );

  return mappedProducts.filter(
    (product): product is Product => product !== null,
  );
}

export async function getPublicCatalogue({
  categorySlug,
  query = '',
  cursor,
  pageSize = 24,
}: GetPublicCatalogueInput = {}): Promise<PublicCataloguePage> {
  const parsedQuery = publicQuerySchema.parse(query);
  const parsedCursor = cursor
    ? publicCursorSchema.parse(cursor)
    : undefined;

  if (getCatalogueDataSource() === 'placeholder') {
    return {
      categories: placeholderCategories,
      products: filterPlaceholderProducts(categorySlug, parsedQuery),
      nextCursor: null,
      dataSource: 'placeholder',
    };
  }

  const repository = createCatalogueRepository();
  const categories = await repository.listActiveCategories();
  const activeCategory = categorySlug
    ? categories.find((category) => category.slug === categorySlug)
    : undefined;

  if (categorySlug && !activeCategory) {
    return {
      categories: categories.map(toPublicCategory),
      products: [],
      nextCursor: null,
      dataSource: 'firestore',
    };
  }
  if (parsedQuery.length === 1) {
    return {
      categories: categories.map(toPublicCategory),
      products: [],
      nextCursor: null,
      dataSource: 'firestore',
    };
  }


  if (parsedQuery.length >= 2) {
    const searchRepository: CatalogueSearchRepository =
      createCatalogueSearchRepository();
    const searchRecords = await searchRepository.searchActiveProducts(
      parsedQuery,
      pageSize,
    );
    const rankedProducts = await repository.findActiveProductsByIds(
      searchRecords.map((record) => record.productId),
    );
    const productsById = new Map(
      rankedProducts.map((product) => [product.id, product]),
    );
    const categoryFilteredProducts = searchRecords
      .map((record) => productsById.get(record.productId))
      .filter(
        (product): product is ProductRecord =>
          Boolean(product) &&
          (!activeCategory ||
            product?.categoryId === activeCategory.id),
      );

    return {
      categories: categories.map(toPublicCategory),
      products: await mapFirestoreProducts(
        categoryFilteredProducts,
        categories,
        repository,
      ),
      nextCursor: null,
      dataSource: 'firestore',
    };
  }

  const productPage = await repository.listActiveProducts({
    categoryId: activeCategory?.id,
    cursor: parsedCursor,
    pageSize,
  });

  return {
    categories: categories.map(toPublicCategory),
    products: await mapFirestoreProducts(
      productPage.products,
      categories,
      repository,
    ),
    nextCursor: productPage.nextCursor,
    dataSource: 'firestore',
  };
}

export async function getPublicCategory(categorySlug: string) {
  const catalogue = await getPublicCatalogue({
    categorySlug,
    pageSize: 100,
  });
  const category = catalogue.categories.find(
    (categoryItem) => categoryItem.slug === categorySlug,
  );

  return category
    ? {
        category,
        products: catalogue.products,
        dataSource: catalogue.dataSource,
      }
    : null;
}

export async function getPublicProduct(
  productSlug: string,
): Promise<{
  product: Product;
  relatedProducts: Product[];
  dataSource: 'placeholder' | 'firestore';
} | null> {
  if (getCatalogueDataSource() === 'placeholder') {
    const product = placeholderProducts.find(
      (productItem) => productItem.slug === productSlug,
    );

    if (!product) {
      return null;
    }

    return {
      product,
      relatedProducts: placeholderProducts
        .filter(
          (relatedProduct) =>
            relatedProduct.id !== product.id &&
            relatedProduct.categoryId === product.categoryId,
        )
        .slice(0, 3),
      dataSource: 'placeholder',
    };
  }

  const repository = createCatalogueRepository();
  const productRecord =
    await repository.findActiveProductBySlug(productSlug);

  if (!productRecord) {
    return null;
  }

  const category = await repository.findActiveCategoryById(
    productRecord.categoryId,
  );

  if (!category) {
    return null;
  }

  const product = await mapFirestoreProduct(
    productRecord,
    category,
    repository,
  );

  if (!product) {
    return null;
  }

  const manuallyRelatedProducts =
    productRecord.relatedMode === 'category'
      ? []
      : await repository.findActiveProductsByIds(
          productRecord.relatedProductIds,
        );
  const categoryProducts =
    productRecord.relatedMode === 'manual'
      ? []
      : (
          await repository.listActiveProducts({
            categoryId: category.id,
            pageSize: 12,
          })
        ).products;
  const relatedRecords = [
    ...manuallyRelatedProducts,
    ...categoryProducts,
  ]
    .filter((relatedProduct) => relatedProduct.id !== product.id)
    .filter(
      (relatedProduct, productIndex, allProducts) =>
        allProducts.findIndex(
          (candidate) => candidate.id === relatedProduct.id,
        ) === productIndex,
    )
    .slice(0, 3);

  return {
    product,
    relatedProducts: await mapFirestoreProducts(
      relatedRecords,
      [category],
      repository,
    ),
    dataSource: 'firestore',
  };
}

export async function getPublicProductByVariantId(variantId: string) {
  if (getCatalogueDataSource() === 'placeholder') {
    for (const product of placeholderProducts) {
      const variant = product.variants.find(
        (productVariant) => productVariant.id === variantId,
      );

      if (variant) {
        return { product, variant };
      }
    }

    return null;
  }

  const repository = createCatalogueRepository();
  const variant = await repository.findActiveVariantById(variantId);

  if (!variant) {
    return null;
  }

  const productRecord = await repository.findActiveProductById(
    variant.productId,
  );

  if (!productRecord) {
    return null;
  }

  const category = await repository.findActiveCategoryById(
    productRecord.categoryId,
  );

  if (!category) {
    return null;
  }

  const product = await mapFirestoreProduct(
    productRecord,
    category,
    repository,
  );
  const publicVariant = product?.variants.find(
    (candidate) => candidate.id === variant.id,
  );

  return product && publicVariant
    ? { product, variant: publicVariant }
    : null;
}
