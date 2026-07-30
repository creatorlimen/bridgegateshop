import { z } from 'zod';

import {
  catalogueSlugSchema,
  normalisedSkuSchema,
  productSpecificationSchema,
  seoFieldsSchema,
} from '@/lib/schemas/catalogue';
import { firestoreDocumentIdSchema } from '@/lib/schemas/common';

const plainText = (minimumLength: number, maximumLength: number) =>
  z.string().trim().min(minimumLength).max(maximumLength);

const expectedVersionSchema = z.number().int().positive();
const sortOrderSchema = z.number().int().nonnegative();

export const createCategoryInputSchema = z
  .object({
    name: plainText(1, 120),
    slug: catalogueSlugSchema,
    description: plainText(1, 2_000),
    displayOrder: sortOrderSchema,
    imageMediaId: firestoreDocumentIdSchema.nullable(),
    seo: seoFieldsSchema,
    searchKeywords: z.array(plainText(1, 60)).max(30),
  })
  .strict();

export const updateCategoryInputSchema = createCategoryInputSchema
  .extend({
    categoryId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
  })
  .strict();

export const categoryStatusInputSchema = z
  .object({
    categoryId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
  })
  .strict();

export const archiveCategoryInputSchema = categoryStatusInputSchema
  .extend({
    reason: plainText(3, 500),
  })
  .strict();

export const createProductInputSchema = z
  .object({
    name: plainText(1, 160),
    slug: catalogueSlugSchema,
    shortDescription: plainText(1, 320),
    description: plainText(1, 20_000),
    categoryId: firestoreDocumentIdSchema,
    publicationOrder: sortOrderSchema,
    specifications: z.array(productSpecificationSchema).max(50),
    usageGuidance: z.array(plainText(1, 1_000)).max(20),
    calculatorCompatible: z.boolean(),
    relatedProductIds: z.array(firestoreDocumentIdSchema).max(12),
    relatedMode: z.enum(['manual', 'category', 'combined']),
    seo: seoFieldsSchema,
    searchKeywords: z.array(plainText(1, 60)).max(40),
    badge: plainText(1, 80).nullable(),
    featured: z.boolean(),
  })
  .strict();

export const updateProductInputSchema = createProductInputSchema
  .extend({
    productId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
    primaryMediaId: firestoreDocumentIdSchema.nullable(),
  })
  .strict();

export const publishProductInputSchema = z
  .object({
    productId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
    mediaOverrideReason: plainText(10, 500).nullable(),
  })
  .strict();

export const archiveProductInputSchema = z
  .object({
    productId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
    reason: plainText(3, 500),
  })
  .strict();

const coverageRateInputSchema = z
  .object({
    areaSquareMetres: z.number().positive().finite(),
    perUnits: z.number().int().positive(),
    assumptions: plainText(1, 500),
    revision: z.number().int().positive(),
  })
  .strict();

const variantFieldsSchema = z
  .object({
    productId: firestoreDocumentIdSchema,
    name: plainText(1, 120),
    sku: plainText(2, 80),
    skuNormalised: normalisedSkuSchema,
    optionValues: z.record(plainText(1, 120)),
    packageLabel: plainText(1, 120),
    priceKobo: z.number().int().nonnegative(),
    compareAtPriceKobo: z.number().int().nonnegative().nullable(),
    status: z.enum(['active', 'inactive']),
    stockManaged: z.boolean(),
    lowStockThreshold: z.number().int().nonnegative(),
    coverageRate: coverageRateInputSchema.nullable(),
    weightGrams: z.number().int().positive().nullable(),
    publicationOrder: sortOrderSchema,
  })
  .strict();

function validateNormalisedSku(
  variant: {
    sku: string;
    skuNormalised: string;
  },
  refinementContext: z.RefinementCtx,
) {
  if (variant.sku.trim().toUpperCase() !== variant.skuNormalised) {
    refinementContext.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The normalised SKU must match the canonical SKU.',
      path: ['skuNormalised'],
    });
  }
}

export const createVariantInputSchema =
  variantFieldsSchema.superRefine(validateNormalisedSku);

export const updateVariantInputSchema = variantFieldsSchema
  .omit({ productId: true })
  .extend({
    variantId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
  })
  .strict()
  .superRefine(validateNormalisedSku);

export const archiveVariantInputSchema = z
  .object({
    variantId: firestoreDocumentIdSchema,
    expectedVersion: expectedVersionSchema,
    reason: plainText(3, 500),
  })
  .strict();

export type CreateCategoryInput = z.infer<
  typeof createCategoryInputSchema
>;
export type UpdateCategoryInput = z.infer<
  typeof updateCategoryInputSchema
>;
export type CategoryStatusInput = z.infer<
  typeof categoryStatusInputSchema
>;
export type ArchiveCategoryInput = z.infer<
  typeof archiveCategoryInputSchema
>;
export type CreateProductInput = z.infer<
  typeof createProductInputSchema
>;
export type UpdateProductInput = z.infer<
  typeof updateProductInputSchema
>;
export type PublishProductInput = z.infer<
  typeof publishProductInputSchema
>;
export type ArchiveProductInput = z.infer<
  typeof archiveProductInputSchema
>;
export type CreateVariantInput = z.infer<
  typeof createVariantInputSchema
>;
export type UpdateVariantInput = z.infer<
  typeof updateVariantInputSchema
>;
export type ArchiveVariantInput = z.infer<
  typeof archiveVariantInputSchema
>;
