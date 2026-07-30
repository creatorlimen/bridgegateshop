import 'server-only';

import {
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import type { ZodType } from 'zod';

import type { DomainErrorCode } from '@/lib/actions/actionResult';
import type { Role } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  catalogueSkuClaimDocumentSchema,
  catalogueSlugClaimDocumentSchema,
} from '@/lib/schemas/catalogueClaims';
import {
  categoryDocumentSchema,
  type CategoryRecord,
  type ProductDocument,
  type ProductRecord,
  productDocumentSchema,
  productMediaDocumentSchema,
  type ProductVariantRecord,
  productVariantDocumentSchema,
} from '@/lib/schemas/catalogue';
import {
  type ArchiveCategoryInput,
  type ArchiveProductInput,
  type ArchiveVariantInput,
  type CategoryStatusInput,
  type CreateCategoryInput,
  type CreateProductInput,
  type CreateVariantInput,
  type PublishProductInput,
  type UpdateCategoryInput,
  type UpdateProductInput,
  type UpdateVariantInput,
} from '@/lib/schemas/catalogueMutations';
import type { CatalogueSearchDocument } from '@/lib/schemas/catalogueSearch';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';
import { createSearchTokenProjection } from '@/lib/utils/catalogue/searchTokens';

export type CatalogueMutationActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

export class CatalogueMutationError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly fieldName?: string,
  ) {
    super(message);
    this.name = 'CatalogueMutationError';
  }
}

function parseRecord<DocumentType>(
  snapshot: DocumentSnapshot,
  schema: ZodType<DocumentType>,
  entityLabel: string,
): DocumentType & { id: string } {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success) {
    throw new CatalogueMutationError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? `${entityLabel} contains invalid stored data.`
        : `${entityLabel} was not found.`,
    );
  }

  return {
    id: snapshot.id,
    ...parsedDocument.data,
  };
}

function assertExpectedVersion(
  actualVersion: number,
  expectedVersion: number,
) {
  if (actualVersion !== expectedVersion) {
    throw new CatalogueMutationError(
      'CONFLICT',
      'This record changed after the page loaded. Refresh and try again.',
      'expectedVersion',
    );
  }
}
function omitInputKeys<
  Input extends object,
  Key extends keyof Input,
>(
  input: Input,
  keys: readonly Key[],
): Omit<Input, Key> {
  const result: Partial<Input> = { ...input };

  for (const key of keys) {
    delete result[key];
  }

  return result as Omit<Input, Key>;
}

function isPublishedProduct(product: ProductDocument) {
  return product.status === 'active' || product.status === 'outOfStock';
}

function getSlugClaimReference(
  firestore: Firestore,
  ownerType: 'category' | 'product',
  slug: string,
) {
  return firestore
    .collection(firestoreCollections.slugClaims)
    .doc(`${ownerType}:${slug}`);
}

function assertSlugClaimAvailable(
  claimSnapshot: DocumentSnapshot,
  ownerType: 'category' | 'product',
  ownerId: string,
) {
  if (!claimSnapshot.exists) {
    return;
  }

  const parsedClaim = catalogueSlugClaimDocumentSchema.safeParse(
    claimSnapshot.data(),
  );

  if (
    !parsedClaim.success ||
    parsedClaim.data.ownerType !== ownerType ||
    parsedClaim.data.ownerId !== ownerId
  ) {
    throw new CatalogueMutationError(
      'CONFLICT',
      'That slug is already in use.',
      'slug',
    );
  }
}

function assertSkuClaimAvailable(
  claimSnapshot: DocumentSnapshot,
  variantId: string,
) {
  if (!claimSnapshot.exists) {
    return;
  }

  const parsedClaim = catalogueSkuClaimDocumentSchema.safeParse(
    claimSnapshot.data(),
  );

  if (
    !parsedClaim.success ||
    parsedClaim.data.ownerId !== variantId
  ) {
    throw new CatalogueMutationError(
      'CONFLICT',
      'That SKU is already in use.',
      'sku',
    );
  }
}

function createSlugClaim(
  ownerType: 'category' | 'product',
  ownerId: string,
  actorId: string,
  now: Timestamp,
) {
  return {
    schemaVersion: 1,
    ownerType,
    ownerId,
    claimedAt: now,
    claimedBy: actorId,
  };
}

function parseVariantDocuments(
  snapshots: QueryDocumentSnapshot[],
): ProductVariantRecord[] {
  return snapshots.map((variantSnapshot) =>
    parseRecord(
      variantSnapshot,
      productVariantDocumentSchema,
      'Product variant',
    ),
  );
}

function getActiveVariantsAfterChange(
  currentVariants: ProductVariantRecord[],
  changedVariant?: ProductVariantRecord,
) {
  const variantsById = new Map(
    currentVariants.map((variant) => [variant.id, variant]),
  );

  if (changedVariant) {
    variantsById.set(changedVariant.id, changedVariant);
  }

  return [...variantsById.values()].filter(
    (variant) => variant.status === 'active',
  );
}

function getProductSummary(
  activeVariants: ProductVariantRecord[],
  currentProduct: ProductDocument,
) {
  if (activeVariants.length === 0) {
    return {
      priceSummary: {
        minimumPriceKobo: 0,
        maximumPriceKobo: 0,
        currency: 'NGN' as const,
      },
      availabilitySummary: {
        stockState: 'outOfStock' as const,
        activeVariantCount: 0,
      },
    };
  }

  const variantPrices = activeVariants.map(
    (variant) => variant.priceKobo,
  );

  return {
    priceSummary: {
      minimumPriceKobo: Math.min(...variantPrices),
      maximumPriceKobo: Math.max(...variantPrices),
      currency: 'NGN' as const,
    },
    availabilitySummary: {
      stockState:
        currentProduct.availabilitySummary.stockState === 'outOfStock'
          ? ('notManaged' as const)
          : currentProduct.availabilitySummary.stockState,
      activeVariantCount: activeVariants.length,
    },
  };
}

function buildSearchDocument(
  product: ProductRecord,
  category: CategoryRecord,
  now: Timestamp,
): CatalogueSearchDocument {
  if (!product.primaryMediaId || !isPublishedProduct(product)) {
    throw new CatalogueMutationError(
      'INVALID_STATE',
      'Only complete published products can be indexed.',
    );
  }

  const tokenProjection = createSearchTokenProjection([
    product.name,
    product.shortDescription,
    product.description,
    category.name,
    ...category.searchKeywords,
    ...product.searchKeywords,
    ...product.specifications.flatMap((specification) => [
      specification.label,
      specification.value,
    ]),
  ]);

  return {
    schemaVersion: 1,
    type: 'product',
    productId: product.id,
    title: product.name,
    slug: product.slug,
    excerpt: product.shortDescription,
    categoryId: product.categoryId,
    imageMediaId: product.primaryMediaId,
    minimumPriceKobo: product.priceSummary.minimumPriceKobo,
    maximumPriceKobo: product.priceSummary.maximumPriceKobo,
    currency: 'NGN',
    stockState: product.availabilitySummary.stockState,
    exactTokens: tokenProjection.exactTokens,
    searchTokens: tokenProjection.searchTokens,
    updatedAt: now,
  };
}

function writeSearchProjection(
  transaction: FirebaseFirestore.Transaction,
  firestore: Firestore,
  product: ProductRecord,
  category: CategoryRecord,
  now: Timestamp,
) {
  const searchDocumentReference = firestore
    .collection(firestoreCollections.searchDocuments)
    .doc(`product:${product.id}`);

  if (!isPublishedProduct(product)) {
    transaction.delete(searchDocumentReference);
    return;
  }

  transaction.set(
    searchDocumentReference,
    buildSearchDocument(product, category, now),
  );
}

class FirestoreCatalogueMutationService {
  constructor(private readonly firestore: Firestore) {}

  async createCategory(
    input: CreateCategoryInput,
    actor: CatalogueMutationActor,
  ) {
    const categoryReference = this.firestore
      .collection(firestoreCollections.categories)
      .doc();
    const claimReference = getSlugClaimReference(
      this.firestore,
      'category',
      input.slug,
    );

    return this.firestore.runTransaction(async (transaction) => {
      const [categorySnapshot, claimSnapshot] = await transaction.getAll(
        categoryReference,
        claimReference,
      );

      if (categorySnapshot.exists) {
        throw new CatalogueMutationError(
          'CONFLICT',
          'Unable to allocate a category ID.',
        );
      }

      assertSlugClaimAvailable(
        claimSnapshot,
        'category',
        categoryReference.id,
      );

      const now = Timestamp.now();
      const category = categoryDocumentSchema.parse({
        ...input,
        schemaVersion: 1,
        createdAt: now,
        createdBy: actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: 1,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        status: 'draft',
      });

      transaction.create(categoryReference, category);
      transaction.create(
        claimReference,
        createSlugClaim(
          'category',
          categoryReference.id,
          actor.actorId,
          now,
        ),
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.category.create',
        entityType: 'category',
        entityId: categoryReference.id,
        publicReference: input.slug,
        changedFields: Object.keys(input),
      });

      return {
        id: categoryReference.id,
        ...category,
      };
    });
  }

  async updateCategory(
    input: UpdateCategoryInput,
    actor: CatalogueMutationActor,
  ) {
    const categoryReference = this.firestore
      .collection(firestoreCollections.categories)
      .doc(input.categoryId);
    const claimReference = getSlugClaimReference(
      this.firestore,
      'category',
      input.slug,
    );

    return this.firestore.runTransaction(async (transaction) => {
      const [categorySnapshot, claimSnapshot] = await transaction.getAll(
        categoryReference,
        claimReference,
      );
      const currentCategory = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      assertExpectedVersion(
        currentCategory.version,
        input.expectedVersion,
      );

      if (currentCategory.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Archived categories cannot be edited.',
        );
      }

      assertSlugClaimAvailable(
        claimSnapshot,
        'category',
        currentCategory.id,
      );

      const now = Timestamp.now();
      const fields = omitInputKeys(input, ['categoryId', 'expectedVersion']);
      const updatedCategory = categoryDocumentSchema.parse({
        ...currentCategory,
        ...fields,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentCategory.version + 1,
      });

      transaction.set(categoryReference, updatedCategory);

      if (!claimSnapshot.exists) {
        transaction.create(
          claimReference,
          createSlugClaim(
            'category',
            currentCategory.id,
            actor.actorId,
            now,
          ),
        );
      }

      if (currentCategory.slug !== updatedCategory.slug) {
        transaction.set(
          this.firestore
            .collection(firestoreCollections.slugRedirects)
            .doc(`category:${currentCategory.slug}`),
          {
            schemaVersion: 1,
            ownerType: 'category',
            ownerId: currentCategory.id,
            sourceSlug: currentCategory.slug,
            targetSlug: updatedCategory.slug,
            createdAt: now,
            createdBy: actor.actorId,
          },
        );
      }

      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.category.update',
        entityType: 'category',
        entityId: currentCategory.id,
        publicReference: updatedCategory.slug,
        changedFields: Object.keys(fields),
      });

      return {
        id: currentCategory.id,
        ...updatedCategory,
      };
    });
  }

  async activateCategory(
    input: CategoryStatusInput,
    actor: CatalogueMutationActor,
  ) {
    const categoryReference = this.firestore
      .collection(firestoreCollections.categories)
      .doc(input.categoryId);

    return this.firestore.runTransaction(async (transaction) => {
      const categorySnapshot = await transaction.get(categoryReference);
      const currentCategory = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      assertExpectedVersion(
        currentCategory.version,
        input.expectedVersion,
      );

      if (currentCategory.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Archived categories cannot be activated.',
        );
      }

      const now = Timestamp.now();
      const updatedCategory = categoryDocumentSchema.parse({
        ...currentCategory,
        status: 'active',
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentCategory.version + 1,
      });

      transaction.set(categoryReference, updatedCategory);
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.category.activate',
        entityType: 'category',
        entityId: currentCategory.id,
        publicReference: updatedCategory.slug,
        changedFields: ['status'],
      });

      return {
        id: currentCategory.id,
        ...updatedCategory,
      };
    });
  }

  async archiveCategory(
    input: ArchiveCategoryInput,
    actor: CatalogueMutationActor,
  ) {
    const categoryReference = this.firestore
      .collection(firestoreCollections.categories)
      .doc(input.categoryId);
    const productQuery = this.firestore
      .collection(firestoreCollections.products)
      .where('categoryId', '==', input.categoryId)
      .where('status', 'in', ['draft', 'active', 'outOfStock'])
      .limit(1);

    return this.firestore.runTransaction(async (transaction) => {
      const categorySnapshot = await transaction.get(categoryReference);
      const productSnapshot = await transaction.get(productQuery);
      const currentCategory = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      assertExpectedVersion(
        currentCategory.version,
        input.expectedVersion,
      );

      if (!productSnapshot.empty) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Move or archive every product in this category first.',
        );
      }

      const now = Timestamp.now();
      const archivedCategory = categoryDocumentSchema.parse({
        ...currentCategory,
        status: 'archived',
        archivedAt: now,
        archivedBy: actor.actorId,
        archiveReason: input.reason,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentCategory.version + 1,
      });

      transaction.set(categoryReference, archivedCategory);
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.category.archive',
        entityType: 'category',
        entityId: currentCategory.id,
        publicReference: currentCategory.slug,
        changedFields: ['status', 'archivedAt', 'archivedBy'],
        reason: input.reason,
      });

      return {
        id: currentCategory.id,
        ...archivedCategory,
      };
    });
  }

  async createProduct(
    input: CreateProductInput,
    actor: CatalogueMutationActor,
  ) {
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc();
    const categoryReference = this.firestore
      .collection(firestoreCollections.categories)
      .doc(input.categoryId);
    const claimReference = getSlugClaimReference(
      this.firestore,
      'product',
      input.slug,
    );

    return this.firestore.runTransaction(async (transaction) => {
      const [productSnapshot, categorySnapshot, claimSnapshot] =
        await transaction.getAll(
          productReference,
          categoryReference,
          claimReference,
        );

      if (productSnapshot.exists) {
        throw new CatalogueMutationError(
          'CONFLICT',
          'Unable to allocate a product ID.',
        );
      }

      const category = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      if (category.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Products cannot be added to an archived category.',
          'categoryId',
        );
      }

      assertSlugClaimAvailable(
        claimSnapshot,
        'product',
        productReference.id,
      );

      const now = Timestamp.now();
      const product = productDocumentSchema.parse({
        ...input,
        schemaVersion: 1,
        createdAt: now,
        createdBy: actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: 1,
        tagIds: [],
        status: 'draft',
        primaryMediaId: null,
        publishedAt: null,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        priceSummary: {
          minimumPriceKobo: 0,
          maximumPriceKobo: 0,
          currency: 'NGN',
        },
        availabilitySummary: {
          stockState: 'notManaged',
          activeVariantCount: 0,
        },
      });

      transaction.create(productReference, product);
      transaction.create(
        claimReference,
        createSlugClaim(
          'product',
          productReference.id,
          actor.actorId,
          now,
        ),
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.product.create',
        entityType: 'product',
        entityId: productReference.id,
        publicReference: product.slug,
        changedFields: Object.keys(input),
      });

      return {
        id: productReference.id,
        ...product,
      };
    });
  }

  async updateProduct(
    input: UpdateProductInput,
    actor: CatalogueMutationActor,
  ) {
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc(input.productId);
    const categoryReference = this.firestore
      .collection(firestoreCollections.categories)
      .doc(input.categoryId);
    const claimReference = getSlugClaimReference(
      this.firestore,
      'product',
      input.slug,
    );
    const mediaReference = input.primaryMediaId
      ? this.firestore
          .collection(firestoreCollections.productMedia)
          .doc(input.primaryMediaId)
      : null;
    const references = [
      productReference,
      categoryReference,
      claimReference,
      ...(mediaReference ? [mediaReference] : []),
    ];

    return this.firestore.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(...references);
      const currentProduct = parseRecord(
        snapshots[0],
        productDocumentSchema,
        'Product',
      );
      const category = parseRecord(
        snapshots[1],
        categoryDocumentSchema,
        'Category',
      );
      const claimSnapshot = snapshots[2];

      assertExpectedVersion(
        currentProduct.version,
        input.expectedVersion,
      );

      if (currentProduct.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Archived products cannot be edited.',
        );
      }

      if (category.status !== 'active' && isPublishedProduct(currentProduct)) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Published products require an active category.',
          'categoryId',
        );
      }

      if (mediaReference) {
        const media = parseRecord(
          snapshots[3],
          productMediaDocumentSchema,
          'Product media',
        );

        if (
          media.productId !== currentProduct.id ||
          media.processingState !== 'ready'
        ) {
          throw new CatalogueMutationError(
            'INVALID_STATE',
            'Primary media must be a ready image owned by this product.',
            'primaryMediaId',
          );
        }
      }

      assertSlugClaimAvailable(
        claimSnapshot,
        'product',
        currentProduct.id,
      );

      const now = Timestamp.now();
      const fields = omitInputKeys(input, ['productId', 'expectedVersion']);
      const updatedProduct = productDocumentSchema.parse({
        ...currentProduct,
        ...fields,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentProduct.version + 1,
      });

      transaction.set(productReference, updatedProduct);

      if (!claimSnapshot.exists) {
        transaction.create(
          claimReference,
          createSlugClaim(
            'product',
            currentProduct.id,
            actor.actorId,
            now,
          ),
        );
      }

      if (currentProduct.slug !== updatedProduct.slug) {
        transaction.set(
          this.firestore
            .collection(firestoreCollections.slugRedirects)
            .doc(`product:${currentProduct.slug}`),
          {
            schemaVersion: 1,
            ownerType: 'product',
            ownerId: currentProduct.id,
            sourceSlug: currentProduct.slug,
            targetSlug: updatedProduct.slug,
            createdAt: now,
            createdBy: actor.actorId,
          },
        );
      }

      writeSearchProjection(
        transaction,
        this.firestore,
        {
          id: currentProduct.id,
          ...updatedProduct,
        },
        category,
        now,
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.product.update',
        entityType: 'product',
        entityId: currentProduct.id,
        publicReference: updatedProduct.slug,
        changedFields: Object.keys(fields),
      });

      return {
        id: currentProduct.id,
        ...updatedProduct,
      };
    });
  }

  async publishProduct(
    input: PublishProductInput,
    actor: CatalogueMutationActor,
  ) {
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc(input.productId);
    const variantQuery = this.firestore
      .collection(firestoreCollections.productVariants)
      .where('productId', '==', input.productId);
    const mediaQuery = this.firestore
      .collection(firestoreCollections.productMedia)
      .where('productId', '==', input.productId);

    return this.firestore.runTransaction(async (transaction) => {
      const productSnapshot = await transaction.get(productReference);
      const currentProduct = parseRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );
      const categoryReference = this.firestore
        .collection(firestoreCollections.categories)
        .doc(currentProduct.categoryId);
      const categorySnapshot = await transaction.get(categoryReference);
      const variantSnapshot = await transaction.get(variantQuery);
      const mediaSnapshot = await transaction.get(mediaQuery);
      const category = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      assertExpectedVersion(
        currentProduct.version,
        input.expectedVersion,
      );

      if (currentProduct.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Archived products cannot be published.',
        );
      }

      if (category.status !== 'active') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Activate the product category before publishing.',
          'categoryId',
        );
      }

      const activeVariants = parseVariantDocuments(
        variantSnapshot.docs,
      ).filter((variant) => variant.status === 'active');
      const readyMedia = mediaSnapshot.docs
        .map((mediaDocument) =>
          parseRecord(
            mediaDocument,
            productMediaDocumentSchema,
            'Product media',
          ),
        )
        .filter((media) => media.processingState === 'ready');

      if (activeVariants.length === 0) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Add at least one active product variant before publishing.',
        );
      }

      if (
        !currentProduct.primaryMediaId ||
        !readyMedia.some(
          (media) => media.id === currentProduct.primaryMediaId,
        )
      ) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Choose a ready primary product image before publishing.',
          'primaryMediaId',
        );
      }

      if (
        readyMedia.length < 3 &&
        (!input.mediaOverrideReason || !actor.roleIds.includes('owner'))
      ) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Normal publication requires at least three ready product images. Only an owner can override this requirement with a reason.',
          'mediaOverrideReason',
        );
      }

      const now = Timestamp.now();
      const summary = getProductSummary(activeVariants, currentProduct);
      const publishedProduct = productDocumentSchema.parse({
        ...currentProduct,
        ...summary,
        status: 'active',
        publishedAt: currentProduct.publishedAt ?? now,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentProduct.version + 1,
      });

      transaction.set(productReference, publishedProduct);
      writeSearchProjection(
        transaction,
        this.firestore,
        {
          id: currentProduct.id,
          ...publishedProduct,
        },
        category,
        now,
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.product.publish',
        entityType: 'product',
        entityId: currentProduct.id,
        publicReference: publishedProduct.slug,
        changedFields: [
          'status',
          'publishedAt',
          'priceSummary',
          'availabilitySummary',
        ],
        reason: input.mediaOverrideReason,
      });

      return {
        id: currentProduct.id,
        ...publishedProduct,
      };
    });
  }

  async archiveProduct(
    input: ArchiveProductInput,
    actor: CatalogueMutationActor,
  ) {
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc(input.productId);

    return this.firestore.runTransaction(async (transaction) => {
      const productSnapshot = await transaction.get(productReference);
      const currentProduct = parseRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );

      assertExpectedVersion(
        currentProduct.version,
        input.expectedVersion,
      );

      const now = Timestamp.now();
      const archivedProduct = productDocumentSchema.parse({
        ...currentProduct,
        status: 'archived',
        archivedAt: now,
        archivedBy: actor.actorId,
        archiveReason: input.reason,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentProduct.version + 1,
      });

      transaction.set(productReference, archivedProduct);
      transaction.delete(
        this.firestore
          .collection(firestoreCollections.searchDocuments)
          .doc(`product:${currentProduct.id}`),
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.product.archive',
        entityType: 'product',
        entityId: currentProduct.id,
        publicReference: currentProduct.slug,
        changedFields: ['status', 'archivedAt', 'archivedBy'],
        reason: input.reason,
      });

      return {
        id: currentProduct.id,
        ...archivedProduct,
      };
    });
  }

  async createVariant(
    input: CreateVariantInput,
    actor: CatalogueMutationActor,
  ) {
    const variantReference = this.firestore
      .collection(firestoreCollections.productVariants)
      .doc();
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc(input.productId);
    const skuClaimReference = this.firestore
      .collection(firestoreCollections.skuClaims)
      .doc(input.skuNormalised);
    const activeVariantQuery = this.firestore
      .collection(firestoreCollections.productVariants)
      .where('productId', '==', input.productId)
      .where('status', '==', 'active');

    return this.firestore.runTransaction(async (transaction) => {
      const [variantSnapshot, productSnapshot, skuClaimSnapshot] =
        await transaction.getAll(
          variantReference,
          productReference,
          skuClaimReference,
        );
      const currentProduct = parseRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );
      const categorySnapshot = await transaction.get(
        this.firestore
          .collection(firestoreCollections.categories)
          .doc(currentProduct.categoryId),
      );
      const activeVariantSnapshot = await transaction.get(
        activeVariantQuery,
      );
      const category = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      if (variantSnapshot.exists) {
        throw new CatalogueMutationError(
          'CONFLICT',
          'Unable to allocate a product variant ID.',
        );
      }

      if (currentProduct.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Variants cannot be added to an archived product.',
        );
      }

      assertSkuClaimAvailable(skuClaimSnapshot, variantReference.id);

      const now = Timestamp.now();
      const variant = productVariantDocumentSchema.parse({
        ...input,
        schemaVersion: 1,
        createdAt: now,
        createdBy: actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: 1,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
      });
      const activeVariants = getActiveVariantsAfterChange(
        parseVariantDocuments(activeVariantSnapshot.docs),
        {
          id: variantReference.id,
          ...variant,
        },
      );
      const summary = getProductSummary(activeVariants, currentProduct);
      const updatedProduct = productDocumentSchema.parse({
        ...currentProduct,
        ...summary,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentProduct.version + 1,
      });

      transaction.create(variantReference, variant);
      transaction.create(skuClaimReference, {
        schemaVersion: 1,
        ownerId: variantReference.id,
        claimedAt: now,
        claimedBy: actor.actorId,
      });
      transaction.set(productReference, updatedProduct);
      writeSearchProjection(
        transaction,
        this.firestore,
        {
          id: currentProduct.id,
          ...updatedProduct,
        },
        category,
        now,
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.variant.create',
        entityType: 'productVariant',
        entityId: variantReference.id,
        publicReference: variant.skuNormalised,
        changedFields: Object.keys(input),
      });

      return {
        id: variantReference.id,
        ...variant,
      };
    });
  }

  async updateVariant(
    input: UpdateVariantInput,
    actor: CatalogueMutationActor,
  ) {
    const variantReference = this.firestore
      .collection(firestoreCollections.productVariants)
      .doc(input.variantId);
    const skuClaimReference = this.firestore
      .collection(firestoreCollections.skuClaims)
      .doc(input.skuNormalised);

    return this.firestore.runTransaction(async (transaction) => {
      const [variantSnapshot, skuClaimSnapshot] =
        await transaction.getAll(
          variantReference,
          skuClaimReference,
        );
      const currentVariant = parseRecord(
        variantSnapshot,
        productVariantDocumentSchema,
        'Product variant',
      );
      const productReference = this.firestore
        .collection(firestoreCollections.products)
        .doc(currentVariant.productId);
      const productSnapshot = await transaction.get(productReference);
      const currentProduct = parseRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );
      const categorySnapshot = await transaction.get(
        this.firestore
          .collection(firestoreCollections.categories)
          .doc(currentProduct.categoryId),
      );
      const activeVariantSnapshot = await transaction.get(
        this.firestore
          .collection(firestoreCollections.productVariants)
          .where('productId', '==', currentVariant.productId)
          .where('status', '==', 'active'),
      );
      const category = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      assertExpectedVersion(
        currentVariant.version,
        input.expectedVersion,
      );

      if (
        currentVariant.status === 'archived' ||
        currentProduct.status === 'archived'
      ) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Archived variants cannot be edited.',
        );
      }

      assertSkuClaimAvailable(skuClaimSnapshot, currentVariant.id);

      const now = Timestamp.now();
      const fields = omitInputKeys(input, ['variantId', 'expectedVersion']);
      const updatedVariant = productVariantDocumentSchema.parse({
        ...currentVariant,
        ...fields,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentVariant.version + 1,
      });
      const activeVariants = getActiveVariantsAfterChange(
        parseVariantDocuments(activeVariantSnapshot.docs),
        {
          id: currentVariant.id,
          ...updatedVariant,
        },
      );

      if (isPublishedProduct(currentProduct) && activeVariants.length === 0) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'A published product must retain at least one active variant.',
        );
      }

      const summary = getProductSummary(activeVariants, currentProduct);
      const updatedProduct = productDocumentSchema.parse({
        ...currentProduct,
        ...summary,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentProduct.version + 1,
      });

      transaction.set(variantReference, updatedVariant);

      if (!skuClaimSnapshot.exists) {
        transaction.create(skuClaimReference, {
          schemaVersion: 1,
          ownerId: currentVariant.id,
          claimedAt: now,
          claimedBy: actor.actorId,
        });
      }

      transaction.set(productReference, updatedProduct);
      writeSearchProjection(
        transaction,
        this.firestore,
        {
          id: currentProduct.id,
          ...updatedProduct,
        },
        category,
        now,
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.variant.update',
        entityType: 'productVariant',
        entityId: currentVariant.id,
        publicReference: updatedVariant.skuNormalised,
        changedFields: Object.keys(fields),
      });

      return {
        id: currentVariant.id,
        ...updatedVariant,
      };
    });
  }

  async archiveVariant(
    input: ArchiveVariantInput,
    actor: CatalogueMutationActor,
  ) {
    const variantReference = this.firestore
      .collection(firestoreCollections.productVariants)
      .doc(input.variantId);

    return this.firestore.runTransaction(async (transaction) => {
      const variantSnapshot = await transaction.get(variantReference);
      const currentVariant = parseRecord(
        variantSnapshot,
        productVariantDocumentSchema,
        'Product variant',
      );
      const productReference = this.firestore
        .collection(firestoreCollections.products)
        .doc(currentVariant.productId);
      const productSnapshot = await transaction.get(productReference);
      const currentProduct = parseRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );
      const categorySnapshot = await transaction.get(
        this.firestore
          .collection(firestoreCollections.categories)
          .doc(currentProduct.categoryId),
      );
      const activeVariantSnapshot = await transaction.get(
        this.firestore
          .collection(firestoreCollections.productVariants)
          .where('productId', '==', currentVariant.productId)
          .where('status', '==', 'active'),
      );
      const category = parseRecord(
        categorySnapshot,
        categoryDocumentSchema,
        'Category',
      );

      assertExpectedVersion(
        currentVariant.version,
        input.expectedVersion,
      );

      const now = Timestamp.now();
      const archivedVariant = productVariantDocumentSchema.parse({
        ...currentVariant,
        status: 'archived',
        archivedAt: now,
        archivedBy: actor.actorId,
        archiveReason: input.reason,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentVariant.version + 1,
      });
      const activeVariants = parseVariantDocuments(
        activeVariantSnapshot.docs,
      ).filter((variant) => variant.id !== currentVariant.id);

      if (isPublishedProduct(currentProduct) && activeVariants.length === 0) {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Archive or unpublish the product before removing its final active variant.',
        );
      }

      const summary = getProductSummary(activeVariants, currentProduct);
      const updatedProduct = productDocumentSchema.parse({
        ...currentProduct,
        ...summary,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: currentProduct.version + 1,
      });

      transaction.set(variantReference, archivedVariant);
      transaction.set(productReference, updatedProduct);
      writeSearchProjection(
        transaction,
        this.firestore,
        {
          id: currentProduct.id,
          ...updatedProduct,
        },
        category,
        now,
      );
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.variant.archive',
        entityType: 'productVariant',
        entityId: currentVariant.id,
        publicReference: currentVariant.skuNormalised,
        changedFields: ['status', 'archivedAt', 'archivedBy'],
        reason: input.reason,
      });

      return {
        id: currentVariant.id,
        ...archivedVariant,
      };
    });
  }
}

export function createCatalogueMutationService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreCatalogueMutationService(firestore);
}
