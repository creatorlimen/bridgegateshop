'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/actionResult';
import {
  PermissionRequiredError,
  requireStaffPermission,
  StaffAccessRequiredError,
} from '@/lib/auth/authorization';
import type { Permission } from '@/lib/auth/permissions';
import {
  archiveCategoryInputSchema,
  archiveProductInputSchema,
  archiveVariantInputSchema,
  categoryStatusInputSchema,
  createCategoryInputSchema,
  updateCategoryInputSchema,
  createProductInputSchema,
  createVariantInputSchema,
  publishProductInputSchema,
  updateProductInputSchema,
  updateVariantInputSchema,
} from '@/lib/schemas/catalogueMutations';
import {
  CatalogueMutationError,
  createCatalogueMutationService,
  type CatalogueMutationActor,
} from '@/lib/services/catalogue/CatalogueMutationService';

type EntityActionData = {
  entityId: string;
};

function getRequiredText(formData: FormData, fieldName: string) {
  return String(formData.get(fieldName) ?? '').trim();
}

function getNullableText(formData: FormData, fieldName: string) {
  const value = getRequiredText(formData, fieldName);
  return value || null;
}

function getInteger(formData: FormData, fieldName: string) {
  return Number(getRequiredText(formData, fieldName));
}

function getOptionalNumber(formData: FormData, fieldName: string) {
  const value = getRequiredText(formData, fieldName);
  return value ? Number(value) : null;
}

function getBoolean(formData: FormData, fieldName: string) {
  return formData.get(fieldName) === 'on';
}

function getList(
  formData: FormData,
  fieldName: string,
  separator: RegExp = /[\r\n,]+/,
) {
  return getRequiredText(formData, fieldName)
    .split(separator)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getKeyValueList(formData: FormData, fieldName: string) {
  return getList(formData, fieldName, /[\r\n]+/).map((line) => {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex < 1) {
      return {
        label: '',
        value: line,
      };
    }

    return {
      label: line.slice(0, separatorIndex).trim(),
      value: line.slice(separatorIndex + 1).trim(),
    };
  });
}

function getSeoFields(formData: FormData) {
  return {
    title: getNullableText(formData, 'seoTitle'),
    description: getNullableText(formData, 'seoDescription'),
    canonicalUrl: getNullableText(formData, 'canonicalUrl'),
    socialMediaId: getNullableText(formData, 'socialMediaId'),
  };
}

function parseNairaToKobo(value: string) {
  const parsedValue = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());

  if (!parsedValue) {
    return Number.NaN;
  }

  return (
    Number(parsedValue[1]) * 100 +
    Number((parsedValue[2] ?? '').padEnd(2, '0'))
  );
}

function getCategoryFields(formData: FormData) {
  return {
    name: getRequiredText(formData, 'name'),
    slug: getRequiredText(formData, 'slug'),
    description: getRequiredText(formData, 'description'),
    displayOrder: getInteger(formData, 'displayOrder'),
    imageMediaId: getNullableText(formData, 'imageMediaId'),
    seo: getSeoFields(formData),
    searchKeywords: getList(formData, 'searchKeywords'),
  };
}

function getProductFields(formData: FormData) {
  return {
    name: getRequiredText(formData, 'name'),
    slug: getRequiredText(formData, 'slug'),
    shortDescription: getRequiredText(formData, 'shortDescription'),
    description: getRequiredText(formData, 'description'),
    categoryId: getRequiredText(formData, 'categoryId'),
    publicationOrder: getInteger(formData, 'publicationOrder'),
    specifications: getKeyValueList(formData, 'specifications'),
    usageGuidance: getList(formData, 'usageGuidance', /[\r\n]+/),
    calculatorCompatible: getBoolean(
      formData,
      'calculatorCompatible',
    ),
    relatedProductIds: getList(formData, 'relatedProductIds'),
    relatedMode:
      getRequiredText(formData, 'relatedMode') || 'category',
    seo: getSeoFields(formData),
    searchKeywords: getList(formData, 'searchKeywords'),
    badge: getNullableText(formData, 'badge'),
    featured: getBoolean(formData, 'featured'),
  };
}

function getVariantFields(formData: FormData) {
  const sku = getRequiredText(formData, 'sku');
  const coverageArea = getOptionalNumber(
    formData,
    'coverageAreaSquareMetres',
  );
  const coveragePerUnits = getOptionalNumber(
    formData,
    'coveragePerUnits',
  );
  const coverageAssumptions = getNullableText(
    formData,
    'coverageAssumptions',
  );
  const optionValues = Object.fromEntries(
    getKeyValueList(formData, 'optionValues')
      .filter((entry) => entry.label && entry.value)
      .map((entry) => [entry.label, entry.value]),
  );

  return {
    name: getRequiredText(formData, 'name'),
    sku,
    skuNormalised: sku.toUpperCase(),
    optionValues,
    packageLabel: getRequiredText(formData, 'packageLabel'),
    priceKobo: parseNairaToKobo(
      getRequiredText(formData, 'priceNaira'),
    ),
    compareAtPriceKobo: getNullableText(formData, 'compareAtPriceNaira')
      ? parseNairaToKobo(
          getRequiredText(formData, 'compareAtPriceNaira'),
        )
      : null,
    status: getRequiredText(formData, 'status') || 'active',
    stockManaged: getBoolean(formData, 'stockManaged'),
    lowStockThreshold: getInteger(formData, 'lowStockThreshold'),
    coverageRate:
      coverageArea && coveragePerUnits && coverageAssumptions
        ? {
            areaSquareMetres: coverageArea,
            perUnits: coveragePerUnits,
            assumptions: coverageAssumptions,
            revision: getInteger(formData, 'coverageRevision') || 1,
          }
        : null,
    weightGrams: getOptionalNumber(formData, 'weightGrams'),
    publicationOrder: getInteger(formData, 'publicationOrder'),
  };
}

async function getMutationActor(
  primaryPermission: Permission,
  additionalPermissions: readonly Permission[] = [],
): Promise<CatalogueMutationActor> {
  const staffContext = await requireStaffPermission(primaryPermission);

  for (const permission of additionalPermissions) {
    if (!staffContext.permissions.has(permission)) {
      throw new PermissionRequiredError(permission);
    }
  }

  return {
    actorId: staffContext.session.uid,
    roleIds: staffContext.membership.roleIds,
    requestId: randomUUID(),
  };
}

function mapActionError(
  error: unknown,
  requestId: string,
): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'Review the highlighted catalogue values and try again.',
      fieldErrors: Object.fromEntries(
        Object.entries(error.flatten().fieldErrors).filter(
          (entry): entry is [string, string[]] => Boolean(entry[1]),
        ),
      ),
      requestId,
    };
  }

  if (error instanceof StaffAccessRequiredError) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'An active staff session is required.',
      requestId,
    };
  }

  if (error instanceof PermissionRequiredError) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: 'Your staff role cannot perform this catalogue action.',
      requestId,
    };
  }

  if (error instanceof CatalogueMutationError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldName
        ? { [error.fieldName]: [error.message] }
        : undefined,
      requestId,
    };
  }

  console.error({
    eventName: 'catalogue.action.failed',
    requestId,
    safeErrorCode: 'INTERNAL_ERROR',
  });

  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'The catalogue action could not be completed.',
    requestId,
  };
}

async function executeCatalogueAction(
  permission: Permission,
  operation: (
    actor: CatalogueMutationActor,
  ) => Promise<{ id: string }>,
  additionalPermissions: readonly Permission[] = [],
): Promise<ActionResult<EntityActionData>> {
  const fallbackRequestId = randomUUID();

  try {
    const actor = await getMutationActor(
      permission,
      additionalPermissions,
    );
    const entity = await operation(actor);

    return {
      ok: true,
      data: { entityId: entity.id },
      requestId: actor.requestId,
    };
  } catch (error) {
    return mapActionError(error, fallbackRequestId);
  }
}

function revalidateCataloguePaths(productSlug?: string) {
  revalidatePath('/');
  revalidatePath('/shop');
  revalidatePath('/search');
  revalidatePath('/admin/catalogue');

  if (productSlug) {
    revalidatePath(`/products/${productSlug}`);
  }
}

export async function createCategoryAction(formData: FormData) {
  return executeCatalogueAction('catalogue.write', async (actor) => {
    const input = createCategoryInputSchema.parse(
      getCategoryFields(formData),
    );
    const result =
      await createCatalogueMutationService().createCategory(input, actor);
    revalidateCataloguePaths();
    return result;
  });
}

export async function activateCategoryAction(formData: FormData) {
  return executeCatalogueAction('catalogue.publish', async (actor) => {
    const input = categoryStatusInputSchema.parse({
      categoryId: getRequiredText(formData, 'categoryId'),
      expectedVersion: getInteger(formData, 'expectedVersion'),
    });
    const result =
      await createCatalogueMutationService().activateCategory(
        input,
        actor,
      );
    revalidateCataloguePaths();
    return result;
  });
}

export async function archiveCategoryAction(formData: FormData) {
  return executeCatalogueAction('catalogue.write', async (actor) => {
    const input = archiveCategoryInputSchema.parse({
      categoryId: getRequiredText(formData, 'categoryId'),
      expectedVersion: getInteger(formData, 'expectedVersion'),
      reason: getRequiredText(formData, 'reason'),
    });
    const result =
      await createCatalogueMutationService().archiveCategory(
        input,
        actor,
      );
    revalidateCataloguePaths();
    return result;
  });
}

export async function createProductAction(formData: FormData) {
  return executeCatalogueAction('catalogue.write', async (actor) => {
    const input = createProductInputSchema.parse(
      getProductFields(formData),
    );
    const result =
      await createCatalogueMutationService().createProduct(input, actor);
    revalidateCataloguePaths();
    return result;
  });
}

export async function updateProductAction(formData: FormData) {
  return executeCatalogueAction('catalogue.write', async (actor) => {
    const input = updateProductInputSchema.parse({
      ...getProductFields(formData),
      productId: getRequiredText(formData, 'productId'),
      expectedVersion: getInteger(formData, 'expectedVersion'),
      primaryMediaId: getNullableText(formData, 'primaryMediaId'),
    });
    const result =
      await createCatalogueMutationService().updateProduct(input, actor);
    revalidateCataloguePaths(result.slug);
    return result;
  });
}

export async function publishProductAction(formData: FormData) {
  return executeCatalogueAction('catalogue.publish', async (actor) => {
    const input = publishProductInputSchema.parse({
      productId: getRequiredText(formData, 'productId'),
      expectedVersion: getInteger(formData, 'expectedVersion'),
      mediaOverrideReason: getNullableText(
        formData,
        'mediaOverrideReason',
      ),
    });
    const result =
      await createCatalogueMutationService().publishProduct(
        input,
        actor,
      );
    revalidateCataloguePaths(result.slug);
    return result;
  });
}

export async function archiveProductAction(formData: FormData) {
  return executeCatalogueAction('catalogue.write', async (actor) => {
    const input = archiveProductInputSchema.parse({
      productId: getRequiredText(formData, 'productId'),
      expectedVersion: getInteger(formData, 'expectedVersion'),
      reason: getRequiredText(formData, 'reason'),
    });
    const result =
      await createCatalogueMutationService().archiveProduct(
        input,
        actor,
      );
    revalidateCataloguePaths(result.slug);
    return result;
  });
}

export async function createVariantAction(formData: FormData) {
  return executeCatalogueAction(
    'catalogue.write',
    async (actor) => {
      const input = createVariantInputSchema.parse({
        ...getVariantFields(formData),
        productId: getRequiredText(formData, 'productId'),
      });
      const result =
        await createCatalogueMutationService().createVariant(
          input,
          actor,
        );
      revalidateCataloguePaths();
      return result;
    },
    ['pricing.write'],
  );
}

export async function updateVariantAction(formData: FormData) {
  return executeCatalogueAction(
    'catalogue.write',
    async (actor) => {
      const input = updateVariantInputSchema.parse({
        ...getVariantFields(formData),
        variantId: getRequiredText(formData, 'variantId'),
        expectedVersion: getInteger(formData, 'expectedVersion'),
      });
      const result =
        await createCatalogueMutationService().updateVariant(
          input,
          actor,
        );
      revalidateCataloguePaths();
      return result;
    },
    ['pricing.write'],
  );
}

export async function archiveVariantAction(formData: FormData) {
  return executeCatalogueAction(
    'catalogue.write',
    async (actor) => {
      const input = archiveVariantInputSchema.parse({
        variantId: getRequiredText(formData, 'variantId'),
        expectedVersion: getInteger(formData, 'expectedVersion'),
        reason: getRequiredText(formData, 'reason'),
      });
      const result =
        await createCatalogueMutationService().archiveVariant(
          input,
          actor,
        );
      revalidateCataloguePaths();
      return result;
    },
    ['pricing.write'],
  );
}

function getActionRedirect(
  path: string,
  result: ActionResult<EntityActionData>,
  successMessage: string,
) {
  const query = result.ok
    ? `notice=${encodeURIComponent(successMessage)}`
    : `error=${encodeURIComponent(result.message)}&requestId=${encodeURIComponent(result.requestId)}`;

  return `${path}?${query}`;
}

export async function createCategoryFormAction(formData: FormData) {
  const result = await createCategoryAction(formData);
  redirect(
    getActionRedirect(
      '/admin/catalogue',
      result,
      'Category draft created.',
    ),
  );
}

export async function activateCategoryFormAction(formData: FormData) {
  const result = await activateCategoryAction(formData);
  redirect(
    getActionRedirect(
      '/admin/catalogue',
      result,
      'Category activated.',
    ),
  );
}

export async function archiveCategoryFormAction(formData: FormData) {
  const result = await archiveCategoryAction(formData);
  redirect(
    getActionRedirect(
      '/admin/catalogue',
      result,
      'Category archived.',
    ),
  );
}

export async function createProductFormAction(formData: FormData) {
  const result = await createProductAction(formData);

  if (result.ok) {
    redirect(
      `/admin/catalogue/products/${result.data.entityId}?notice=${encodeURIComponent('Product draft created.')}`,
    );
  }

  redirect(
    getActionRedirect(
      '/admin/catalogue',
      result,
      'Product draft created.',
    ),
  );
}

export async function updateProductFormAction(formData: FormData) {
  const productId = getRequiredText(formData, 'productId');
  const result = await updateProductAction(formData);
  redirect(
    getActionRedirect(
      `/admin/catalogue/products/${productId}`,
      result,
      'Product details updated.',
    ),
  );
}

export async function publishProductFormAction(formData: FormData) {
  const productId = getRequiredText(formData, 'productId');
  const result = await publishProductAction(formData);
  redirect(
    getActionRedirect(
      `/admin/catalogue/products/${productId}`,
      result,
      'Product published.',
    ),
  );
}

export async function archiveProductFormAction(formData: FormData) {
  const productId = getRequiredText(formData, 'productId');
  const result = await archiveProductAction(formData);
  redirect(
    getActionRedirect(
      `/admin/catalogue/products/${productId}`,
      result,
      'Product archived.',
    ),
  );
}

export async function createVariantFormAction(formData: FormData) {
  const productId = getRequiredText(formData, 'productId');
  const result = await createVariantAction(formData);
  redirect(
    getActionRedirect(
      `/admin/catalogue/products/${productId}`,
      result,
      'Variant created.',
    ),
  );
}

export async function updateVariantFormAction(formData: FormData) {
  const productId = getRequiredText(formData, 'productId');
  const result = await updateVariantAction(formData);
  redirect(
    getActionRedirect(
      `/admin/catalogue/products/${productId}`,
      result,
      'Variant updated.',
    ),
  );
}

export async function archiveVariantFormAction(formData: FormData) {
  const productId = getRequiredText(formData, 'productId');
  const result = await archiveVariantAction(formData);
  redirect(
    getActionRedirect(
      `/admin/catalogue/products/${productId}`,
      result,
      'Variant archived.',
    ),
  );
}

export async function updateCategoryAction(formData: FormData) {
  return executeCatalogueAction('catalogue.write', async (actor) => {
    const input = updateCategoryInputSchema.parse({
      ...getCategoryFields(formData),
      categoryId: getRequiredText(formData, 'categoryId'),
      expectedVersion: getInteger(formData, 'expectedVersion'),
    });
    const result =
      await createCatalogueMutationService().updateCategory(input, actor);
    revalidateCataloguePaths();
    return result;
  });
}

export async function updateCategoryFormAction(formData: FormData) {
  const result = await updateCategoryAction(formData);
  redirect(
    getActionRedirect(
      '/admin/catalogue',
      result,
      'Category updated.',
    ),
  );
}
