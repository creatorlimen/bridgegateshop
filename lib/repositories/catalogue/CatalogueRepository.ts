import 'server-only';

import {
  FieldPath,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import { z, type ZodType } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  cataloguePageCursorSchema,
  catalogueSlugSchema,
  categoryDocumentSchema,
  type CategoryRecord,
  type CataloguePageCursor,
  type ProductMediaRecord,
  productDocumentSchema,
  productMediaDocumentSchema,
  type ProductRecord,
  type ProductVariantRecord,
  productVariantDocumentSchema,
} from '@/lib/schemas/catalogue';
import { firestoreDocumentIdSchema } from '@/lib/schemas/common';

const cataloguePageSizeSchema = z.number().int().min(1).max(100);
const encodedCursorSchema = z.string().min(1).max(1_024);

export type ListActiveProductsInput = {
  categoryId?: string;
  cursor?: string;
  pageSize?: number;
};

export type CatalogueProductPage = {
  products: ProductRecord[];
  nextCursor: string | null;
};

export interface CatalogueRepository {
  listActiveCategories(): Promise<CategoryRecord[]>;
  findActiveCategoryBySlug(slug: string): Promise<CategoryRecord | null>;
  listActiveProducts(
    input?: ListActiveProductsInput,
  ): Promise<CatalogueProductPage>;
  findActiveProductBySlug(slug: string): Promise<ProductRecord | null>;
  listActiveVariantsForProduct(
    productId: string,
  ): Promise<ProductVariantRecord[]>;
  findActiveVariantById(
    variantId: string,
  ): Promise<ProductVariantRecord | null>;
  findReadyProductMediaById(
    mediaId: string,
  ): Promise<ProductMediaRecord | null>;
}

export class CatalogueDataError extends Error {
  readonly collectionName: string;
  readonly documentId: string;

  constructor(
    collectionName: string,
    documentId: string,
    options?: ErrorOptions,
  ) {
    super(
      `Catalogue document ${collectionName}/${documentId} is invalid.`,
      options,
    );
    this.name = 'CatalogueDataError';
    this.collectionName = collectionName;
    this.documentId = documentId;
  }
}

export class CatalogueQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogueQueryError';
  }
}

function parseRecord<DocumentType>(
  snapshot: DocumentSnapshot,
  collectionName: string,
  documentSchema: ZodType<DocumentType>,
): DocumentType & { id: string } {
  const parsedDocument = documentSchema.safeParse(snapshot.data());

  if (!parsedDocument.success) {
    throw new CatalogueDataError(collectionName, snapshot.id, {
      cause: parsedDocument.error,
    });
  }

  return {
    id: snapshot.id,
    ...parsedDocument.data,
  };
}

function encodeCatalogueCursor(cursor: CataloguePageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCatalogueCursor(encodedCursor: string): CataloguePageCursor {
  const parsedEncodedCursor = encodedCursorSchema.safeParse(encodedCursor);

  if (!parsedEncodedCursor.success) {
    throw new CatalogueQueryError('The catalogue page cursor is invalid.', {
      cause: parsedEncodedCursor.error,
    });
  }

  try {
    const decodedCursor: unknown = JSON.parse(
      Buffer.from(parsedEncodedCursor.data, 'base64url').toString('utf8'),
    );
    const parsedCursor = cataloguePageCursorSchema.safeParse(decodedCursor);

    if (!parsedCursor.success) {
      throw parsedCursor.error;
    }

    return parsedCursor.data;
  } catch (error) {
    throw new CatalogueQueryError('The catalogue page cursor is invalid.', {
      cause: error,
    });
  }
}

function parseDocumentId(documentId: string, label: string) {
  const parsedDocumentId = firestoreDocumentIdSchema.safeParse(documentId);

  if (!parsedDocumentId.success) {
    throw new CatalogueQueryError(`${label} is invalid.`, {
      cause: parsedDocumentId.error,
    });
  }

  return parsedDocumentId.data;
}

function parseCatalogueSlug(slug: string) {
  const parsedSlug = catalogueSlugSchema.safeParse(slug);

  if (!parsedSlug.success) {
    throw new CatalogueQueryError('The catalogue slug is invalid.', {
      cause: parsedSlug.error,
    });
  }

  return parsedSlug.data;
}

function parseUniqueQueryResult<DocumentType>(
  snapshots: DocumentSnapshot[],
  collectionName: string,
  documentSchema: ZodType<DocumentType>,
): (DocumentType & { id: string }) | null {
  if (snapshots.length === 0) {
    return null;
  }

  if (snapshots.length > 1) {
    throw new CatalogueQueryError(
      `The ${collectionName} uniqueness invariant is violated.`,
    );
  }

  return parseRecord(snapshots[0], collectionName, documentSchema);
}

class FirestoreCatalogueRepository implements CatalogueRepository {
  constructor(private readonly firestore: Firestore) {}

  async listActiveCategories(): Promise<CategoryRecord[]> {
    const categorySnapshot = await this.firestore
      .collection(firestoreCollections.categories)
      .where('status', '==', 'active')
      .orderBy('displayOrder', 'asc')
      .orderBy('name', 'asc')
      .limit(100)
      .get();

    return categorySnapshot.docs.map((categoryDocument) =>
      parseRecord(
        categoryDocument,
        firestoreCollections.categories,
        categoryDocumentSchema,
      ),
    );
  }

  async findActiveCategoryBySlug(
    slug: string,
  ): Promise<CategoryRecord | null> {
    const categorySnapshot = await this.firestore
      .collection(firestoreCollections.categories)
      .where('slug', '==', parseCatalogueSlug(slug))
      .where('status', '==', 'active')
      .limit(2)
      .get();

    return parseUniqueQueryResult(
      categorySnapshot.docs,
      firestoreCollections.categories,
      categoryDocumentSchema,
    );
  }

  async listActiveProducts({
    categoryId,
    cursor,
    pageSize = 24,
  }: ListActiveProductsInput = {}): Promise<CatalogueProductPage> {
    const parsedPageSize = cataloguePageSizeSchema.safeParse(pageSize);

    if (!parsedPageSize.success) {
      throw new CatalogueQueryError(
        'Catalogue page size must be between 1 and 100.',
        {
          cause: parsedPageSize.error,
        },
      );
    }

    let productQuery: Query = this.firestore
      .collection(firestoreCollections.products)
      .where('status', '==', 'active');

    if (categoryId !== undefined) {
      productQuery = productQuery.where(
        'categoryId',
        '==',
        parseDocumentId(categoryId, 'Category ID'),
      );
    }

    productQuery = productQuery
      .orderBy('publicationOrder', 'asc')
      .orderBy('name', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');

    if (cursor !== undefined) {
      const decodedCursor = decodeCatalogueCursor(cursor);

      productQuery = productQuery.startAfter(
        decodedCursor.publicationOrder,
        decodedCursor.name,
        decodedCursor.documentId,
      );
    }

    const productSnapshot = await productQuery
      .limit(parsedPageSize.data + 1)
      .get();
    const hasNextPage = productSnapshot.docs.length > parsedPageSize.data;
    const pageDocuments = productSnapshot.docs.slice(
      0,
      parsedPageSize.data,
    );
    const products = pageDocuments.map((productDocument) =>
      parseRecord(
        productDocument,
        firestoreCollections.products,
        productDocumentSchema,
      ),
    );
    const lastProduct = products.at(-1);

    return {
      products,
      nextCursor:
        hasNextPage && lastProduct
          ? encodeCatalogueCursor({
              publicationOrder: lastProduct.publicationOrder,
              name: lastProduct.name,
              documentId: lastProduct.id,
            })
          : null,
    };
  }

  async findActiveProductBySlug(
    slug: string,
  ): Promise<ProductRecord | null> {
    const productSnapshot = await this.firestore
      .collection(firestoreCollections.products)
      .where('slug', '==', parseCatalogueSlug(slug))
      .where('status', '==', 'active')
      .limit(2)
      .get();

    return parseUniqueQueryResult(
      productSnapshot.docs,
      firestoreCollections.products,
      productDocumentSchema,
    );
  }

  async listActiveVariantsForProduct(
    productId: string,
  ): Promise<ProductVariantRecord[]> {
    const variantSnapshot = await this.firestore
      .collection(firestoreCollections.productVariants)
      .where(
        'productId',
        '==',
        parseDocumentId(productId, 'Product ID'),
      )
      .where('status', '==', 'active')
      .orderBy('publicationOrder', 'asc')
      .orderBy('name', 'asc')
      .limit(100)
      .get();

    return variantSnapshot.docs.map((variantDocument) =>
      parseRecord(
        variantDocument,
        firestoreCollections.productVariants,
        productVariantDocumentSchema,
      ),
    );
  }

  async findActiveVariantById(
    variantId: string,
  ): Promise<ProductVariantRecord | null> {
    const parsedVariantId = parseDocumentId(variantId, 'Variant ID');
    const variantDocument = await this.firestore
      .collection(firestoreCollections.productVariants)
      .doc(parsedVariantId)
      .get();

    if (!variantDocument.exists) {
      return null;
    }

    const variant = parseRecord(
      variantDocument,
      firestoreCollections.productVariants,
      productVariantDocumentSchema,
    );

    return variant.status === 'active' ? variant : null;
  }

  async findReadyProductMediaById(
    mediaId: string,
  ): Promise<ProductMediaRecord | null> {
    const parsedMediaId = parseDocumentId(mediaId, 'Product media ID');
    const mediaDocument = await this.firestore
      .collection(firestoreCollections.productMedia)
      .doc(parsedMediaId)
      .get();

    if (!mediaDocument.exists) {
      return null;
    }

    const media = parseRecord(
      mediaDocument,
      firestoreCollections.productMedia,
      productMediaDocumentSchema,
    );

    return media.processingState === 'ready' ? media : null;
  }
}

export function createCatalogueRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
): CatalogueRepository {
  return new FirestoreCatalogueRepository(firestore);
}
