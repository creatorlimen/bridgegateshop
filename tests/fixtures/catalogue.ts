import type {
  CategoryDocument,
  ProductDocument,
  ProductMediaDocument,
  ProductVariantDocument,
} from '@/lib/schemas/catalogue';

type SeedRecord<DocumentType> = {
  id: string;
  data: DocumentType;
};

type SeedProductDefinition = {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  priceKobo: number;
  coverageSquareMetres: number;
  stockState: ProductDocument['availabilitySummary']['stockState'];
};

const seedActor = 'system:test-seed';
const seedTimestamp = new Date('2026-01-15T09:00:00.000Z');

const commonRecordFields = {
  schemaVersion: 1,
  createdAt: seedTimestamp,
  createdBy: seedActor,
  updatedAt: seedTimestamp,
  updatedBy: seedActor,
  version: 1,
} as const;

const activeArchiveFields = {
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
} as const;

const emptySeoFields = {
  title: null,
  description: null,
  canonicalUrl: null,
  socialMediaId: null,
} as const;

export const categorySeedRecords: SeedRecord<CategoryDocument>[] = [
  {
    id: 'category-pop-paint',
    data: {
      ...commonRecordFields,
      ...activeArchiveFields,
      name: 'POP Paint',
      slug: 'pop-paint',
      description:
        'Interior finishing paints for POP ceilings, walls, and decorative details.',
      status: 'active',
      displayOrder: 10,
      imageMediaId: null,
      seo: emptySeoFields,
      searchKeywords: ['paint', 'pop', 'ceiling'],
    },
  },
  {
    id: 'category-white-bond',
    data: {
      ...commonRecordFields,
      ...activeArchiveFields,
      name: 'White Bond',
      slug: 'white-bond',
      description:
        'Bonding compounds for tile, screed, and interior finishing applications.',
      status: 'active',
      displayOrder: 20,
      imageMediaId: null,
      seo: emptySeoFields,
      searchKeywords: ['bond', 'adhesive', 'finishing'],
    },
  },
];

const seedProductDefinitions: SeedProductDefinition[] = [
  {
    id: 'product-signature-pop',
    categoryId: 'category-pop-paint',
    name: 'Signature POP Paint',
    slug: 'signature-pop-paint',
    priceKobo: 1_250_000,
    coverageSquareMetres: 24,
    stockState: 'inStock',
  },
  {
    id: 'product-pro-cover-pop',
    categoryId: 'category-pop-paint',
    name: 'Pro Cover POP Paint',
    slug: 'pro-cover-pop-paint',
    priceKobo: 3_850_000,
    coverageSquareMetres: 110,
    stockState: 'inStock',
  },
  {
    id: 'product-smooth-finish-pop',
    categoryId: 'category-pop-paint',
    name: 'Smooth Finish POP Paint',
    slug: 'smooth-finish-pop-paint',
    priceKobo: 1_475_000,
    coverageSquareMetres: 25.5,
    stockState: 'lowStock',
  },
  {
    id: 'product-trade-matt-pop',
    categoryId: 'category-pop-paint',
    name: 'Trade Matt POP Paint',
    slug: 'trade-matt-pop-paint',
    priceKobo: 3_250_000,
    coverageSquareMetres: 108,
    stockState: 'inStock',
  },
  {
    id: 'product-quick-dry-pop',
    categoryId: 'category-pop-paint',
    name: 'Quick Dry POP Paint',
    slug: 'quick-dry-pop-paint',
    priceKobo: 1_650_000,
    coverageSquareMetres: 23.75,
    stockState: 'outOfStock',
  },
  {
    id: 'product-white-bond-standard',
    categoryId: 'category-white-bond',
    name: 'White Bond Standard',
    slug: 'white-bond-standard',
    priceKobo: 1_850_000,
    coverageSquareMetres: 10,
    stockState: 'inStock',
  },
  {
    id: 'product-white-bond-pro',
    categoryId: 'category-white-bond',
    name: 'White Bond Pro',
    slug: 'white-bond-pro',
    priceKobo: 2_250_000,
    coverageSquareMetres: 12,
    stockState: 'lowStock',
  },
  {
    id: 'product-white-bond-flex',
    categoryId: 'category-white-bond',
    name: 'White Bond Flex',
    slug: 'white-bond-flex',
    priceKobo: 2_475_000,
    coverageSquareMetres: 11.5,
    stockState: 'inStock',
  },
  {
    id: 'product-white-bond-fast-set',
    categoryId: 'category-white-bond',
    name: 'White Bond Fast Set',
    slug: 'white-bond-fast-set',
    priceKobo: 2_600_000,
    coverageSquareMetres: 9.75,
    stockState: 'inStock',
  },
  {
    id: 'product-white-bond-project',
    categoryId: 'category-white-bond',
    name: 'White Bond Project',
    slug: 'white-bond-project',
    priceKobo: 2_150_000,
    coverageSquareMetres: 10.5,
    stockState: 'outOfStock',
  },
];

export const productSeedRecords: SeedRecord<ProductDocument>[] =
  seedProductDefinitions.map((productDefinition, productIndex) => {
    const mediaId = `media-${productDefinition.id}`;

    return {
      id: productDefinition.id,
      data: {
        ...commonRecordFields,
        ...activeArchiveFields,
        name: productDefinition.name,
        slug: productDefinition.slug,
        shortDescription:
          'Deterministic placeholder catalogue content for data-layer testing.',
        description:
          'This fixture validates catalogue queries, mapping, pagination, and future administration flows. It is not approved product copy.',
        categoryId: productDefinition.categoryId,
        tagIds: [],
        status: 'active',
        publicationOrder: (productIndex + 1) * 10,
        specifications: [
          {
            label: 'Fixture',
            value: 'Placeholder technical specification',
          },
        ],
        usageGuidance: [
          'Replace this fixture guidance with approved product instructions.',
        ],
        calculatorCompatible: true,
        primaryMediaId: mediaId,
        relatedProductIds: [],
        relatedMode: 'category',
        seo: {
          ...emptySeoFields,
          socialMediaId: mediaId,
        },
        searchKeywords: productDefinition.slug.split('-'),
        badge: productIndex < 2 ? 'Publication-ready fixture' : null,
        featured: productIndex < 4,
        publishedAt: seedTimestamp,
        priceSummary: {
          minimumPriceKobo: productDefinition.priceKobo,
          maximumPriceKobo: productDefinition.priceKobo,
          currency: 'NGN',
        },
        availabilitySummary: {
          stockState: productDefinition.stockState,
          activeVariantCount: 1,
        },
      },
    };
  });

export const variantSeedRecords: SeedRecord<ProductVariantDocument>[] =
  seedProductDefinitions.map((productDefinition, productIndex) => {
    const sku = `FIXTURE-${String(productIndex + 1).padStart(3, '0')}`;

    return {
      id: `variant-${productDefinition.id}`,
      data: {
        ...commonRecordFields,
        ...activeArchiveFields,
        productId: productDefinition.id,
        name: 'Standard pack',
        sku,
        skuNormalised: sku,
        optionValues: {
          package: 'Standard',
        },
        packageLabel: 'Fixture pack',
        priceKobo: productDefinition.priceKobo,
        compareAtPriceKobo: null,
        currency: 'NGN',
        status: 'active',
        stockManaged: true,
        lowStockThreshold: 5,
        coverageRate: {
          areaSquareMetres: productDefinition.coverageSquareMetres,
          perUnits: 1,
          assumptions: 'Single-coat fixture coverage for deterministic tests.',
          revision: 1,
        },
        weightGrams: 20_000,
        publicationOrder: 10,
      },
    };
  });

export const productMediaSeedRecords: SeedRecord<ProductMediaDocument>[] =
  seedProductDefinitions.map((productDefinition) => ({
    id: `media-${productDefinition.id}`,
    data: {
      ...commonRecordFields,
      productId: productDefinition.id,
      sourceStorageObjectPath: `product-media/${productDefinition.id}/source.webp`,
      derivatives: [
        {
          kind: 'card',
          storageObjectPath: `product-media/${productDefinition.id}/card.webp`,
          width: 800,
          height: 800,
          bytes: 48_000,
          mimeType: 'image/webp',
        },
      ],
      mimeType: 'image/webp',
      width: 1_600,
      height: 1_600,
      bytes: 180_000,
      altText: `${productDefinition.name} placeholder product image`,
      sortOrder: 10,
      processingState: 'ready',
      uploadedBy: seedActor,
    },
  }));

export const catalogueSeedFixture = {
  categories: categorySeedRecords,
  products: productSeedRecords,
  variants: variantSeedRecords,
  media: productMediaSeedRecords,
} as const;
