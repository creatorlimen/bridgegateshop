import { z } from 'zod';

import {
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
  mutableRecordFieldsSchema,
  softArchiveFieldsSchema,
} from '@/lib/schemas/common';

const boundedPlainTextSchema = (minimumLength: number, maximumLength: number) =>
  z
    .string()
    .trim()
    .min(minimumLength)
    .max(maximumLength)
    .refine(
      (value) => !/<(?:script|iframe|object|embed)\b/i.test(value),
      'Executable or embedded HTML is not allowed.',
    );

export const catalogueSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slugs must use lowercase letters, numbers, and single hyphens.',
  );

export const normalisedSkuSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(
    /^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/,
    'Normalised SKUs must use uppercase letters, numbers, dots, underscores, or hyphens.',
  );

export const seoFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(70).nullable(),
    description: z.string().trim().min(1).max(170).nullable(),
    canonicalUrl: z.string().url().max(2_048).nullable(),
    socialMediaId: firestoreDocumentIdSchema.nullable(),
  })
  .strict();

export const categoryDocumentSchema = mutableRecordFieldsSchema
  .merge(softArchiveFieldsSchema)
  .extend({
    name: boundedPlainTextSchema(1, 120),
    slug: catalogueSlugSchema,
    description: boundedPlainTextSchema(1, 2_000),
    status: z.enum(['draft', 'active', 'archived']),
    displayOrder: z.number().int().nonnegative(),
    imageMediaId: firestoreDocumentIdSchema.nullable(),
    seo: seoFieldsSchema,
    searchKeywords: z
      .array(boundedPlainTextSchema(1, 60))
      .max(30),
  })
  .superRefine((category, refinementContext) => {
    const isArchived = category.status === 'archived';
    const hasCompleteArchiveMetadata =
      category.archivedAt !== null &&
      category.archivedBy !== null &&
      category.archiveReason !== null;

    if (isArchived !== hasCompleteArchiveMetadata) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Archived categories require complete archive metadata, and active records cannot retain it.',
        path: ['archivedAt'],
      });
    }
  });

export const productSpecificationSchema = z
  .object({
    label: boundedPlainTextSchema(1, 80),
    value: boundedPlainTextSchema(1, 300),
  })
  .strict();

export const productDocumentSchema = mutableRecordFieldsSchema
  .merge(softArchiveFieldsSchema)
  .extend({
    name: boundedPlainTextSchema(1, 160),
    slug: catalogueSlugSchema,
    shortDescription: boundedPlainTextSchema(1, 320),
    description: boundedPlainTextSchema(1, 20_000),
    categoryId: firestoreDocumentIdSchema,
    tagIds: z.array(firestoreDocumentIdSchema).max(30),
    status: z.enum(['draft', 'active', 'outOfStock', 'archived']),
    publicationOrder: z.number().int().nonnegative(),
    specifications: z.array(productSpecificationSchema).max(50),
    usageGuidance: z
      .array(boundedPlainTextSchema(1, 1_000))
      .max(20),
    calculatorCompatible: z.boolean(),
    primaryMediaId: firestoreDocumentIdSchema.nullable(),
    relatedProductIds: z.array(firestoreDocumentIdSchema).max(12),
    relatedMode: z.enum(['manual', 'category', 'combined']),
    seo: seoFieldsSchema,
    searchKeywords: z
      .array(boundedPlainTextSchema(1, 60))
      .max(40),
    badge: boundedPlainTextSchema(1, 80).nullable(),
    featured: z.boolean(),
    publishedAt: firestoreTimestampSchema.nullable(),
    priceSummary: z
      .object({
        minimumPriceKobo: z.number().int().nonnegative(),
        maximumPriceKobo: z.number().int().nonnegative(),
        currency: z.literal('NGN'),
      })
      .strict(),
    availabilitySummary: z
      .object({
        stockState: z.enum([
          'inStock',
          'lowStock',
          'outOfStock',
          'notManaged',
        ]),
        activeVariantCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .superRefine((product, refinementContext) => {
    if (
      product.priceSummary.minimumPriceKobo >
      product.priceSummary.maximumPriceKobo
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The minimum price cannot exceed the maximum price.',
        path: ['priceSummary', 'minimumPriceKobo'],
      });
    }

    const isPublished =
      product.status === 'active' || product.status === 'outOfStock';

    if (
      isPublished &&
      (product.primaryMediaId === null || product.publishedAt === null)
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Published products require primary media and a publication timestamp.',
        path: ['primaryMediaId'],
      });
    }

    const isArchived = product.status === 'archived';
    const hasCompleteArchiveMetadata =
      product.archivedAt !== null &&
      product.archivedBy !== null &&
      product.archiveReason !== null;

    if (isArchived !== hasCompleteArchiveMetadata) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Archived products require complete archive metadata, and active records cannot retain it.',
        path: ['archivedAt'],
      });
    }
  });

const coverageRateSchema = z
  .object({
    areaSquareMetres: z.number().positive().finite(),
    perUnits: z.number().int().positive(),
    assumptions: boundedPlainTextSchema(1, 500),
    revision: z.number().int().positive(),
  })
  .strict();

export const productVariantDocumentSchema = mutableRecordFieldsSchema
  .merge(softArchiveFieldsSchema)
  .extend({
    productId: firestoreDocumentIdSchema,
    name: boundedPlainTextSchema(1, 120),
    sku: boundedPlainTextSchema(2, 80),
    skuNormalised: normalisedSkuSchema,
    optionValues: z.record(boundedPlainTextSchema(1, 120)),
    packageLabel: boundedPlainTextSchema(1, 120),
    priceKobo: z.number().int().nonnegative(),
    compareAtPriceKobo: z.number().int().nonnegative().nullable(),
    currency: z.literal('NGN'),
    status: z.enum(['active', 'inactive', 'archived']),
    stockManaged: z.boolean(),
    lowStockThreshold: z.number().int().nonnegative(),
    coverageRate: coverageRateSchema.nullable(),
    weightGrams: z.number().int().positive().nullable(),
    publicationOrder: z.number().int().nonnegative(),
  })
  .superRefine((variant, refinementContext) => {
    if (
      variant.compareAtPriceKobo !== null &&
      variant.compareAtPriceKobo <= variant.priceKobo
    ) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Compare-at price must be greater than the current price.',
        path: ['compareAtPriceKobo'],
      });
    }

    if (Object.keys(variant.optionValues).length > 20) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A variant can contain at most 20 option values.',
        path: ['optionValues'],
      });
    }

    if (variant.sku.trim().toUpperCase() !== variant.skuNormalised) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The normalised SKU must match the canonical SKU.',
        path: ['skuNormalised'],
      });
    }

    const isArchived = variant.status === 'archived';
    const hasCompleteArchiveMetadata =
      variant.archivedAt !== null &&
      variant.archivedBy !== null &&
      variant.archiveReason !== null;

    if (isArchived !== hasCompleteArchiveMetadata) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Archived variants require complete archive metadata, and active records cannot retain it.',
        path: ['archivedAt'],
      });
    }
  });

const mediaDerivativeSchema = z
  .object({
    kind: z.enum(['thumbnail', 'card', 'detail', 'social']),
    storageObjectPath: z.string().trim().min(1).max(1_024),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
    mimeType: z.enum(['image/avif', 'image/jpeg', 'image/png', 'image/webp']),
  })
  .strict();

export const productMediaDocumentSchema = mutableRecordFieldsSchema.extend({
  productId: firestoreDocumentIdSchema,
  sourceStorageObjectPath: z.string().trim().min(1).max(1_024),
  derivatives: z.array(mediaDerivativeSchema).max(8),
  mimeType: z.enum(['image/avif', 'image/jpeg', 'image/png', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  altText: boundedPlainTextSchema(1, 300),
  sortOrder: z.number().int().nonnegative(),
  processingState: z.enum(['pending', 'processing', 'ready', 'failed']),
  uploadedBy: z.string().trim().min(1).max(160),
});

export const cataloguePageCursorSchema = z
  .object({
    publicationOrder: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(160),
    documentId: firestoreDocumentIdSchema,
  })
  .strict();

export type CategoryDocument = z.infer<typeof categoryDocumentSchema>;
export type ProductDocument = z.infer<typeof productDocumentSchema>;
export type ProductVariantDocument = z.infer<
  typeof productVariantDocumentSchema
>;
export type ProductMediaDocument = z.infer<typeof productMediaDocumentSchema>;
export type CataloguePageCursor = z.infer<typeof cataloguePageCursorSchema>;

export type CategoryRecord = CategoryDocument & {
  id: string;
};

export type ProductRecord = ProductDocument & {
  id: string;
};

export type ProductVariantRecord = ProductVariantDocument & {
  id: string;
};

export type ProductMediaRecord = ProductMediaDocument & {
  id: string;
};
