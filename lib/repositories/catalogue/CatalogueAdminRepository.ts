import 'server-only';

import type {
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';
import type { ZodType } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  categoryDocumentSchema,
  type CategoryRecord,
  type ProductMediaRecord,
  type ProductRecord,
  type ProductVariantRecord,
  productDocumentSchema,
  productMediaDocumentSchema,
  productVariantDocumentSchema,
} from '@/lib/schemas/catalogue';
import { firestoreDocumentIdSchema } from '@/lib/schemas/common';

function parseAdminRecord<DocumentType>(
  snapshot: DocumentSnapshot,
  schema: ZodType<DocumentType>,
  entityLabel: string,
): DocumentType & { id: string } {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success) {
    throw new Error(
      snapshot.exists
        ? `${entityLabel} ${snapshot.id} contains invalid stored data.`
        : `${entityLabel} ${snapshot.id} was not found.`,
    );
  }

  return {
    id: snapshot.id,
    ...parsedDocument.data,
  };
}

function parseDocumentId(documentId: string) {
  return firestoreDocumentIdSchema.parse(documentId);
}

export type AdminProductDetail = {
  product: ProductRecord;
  variants: ProductVariantRecord[];
  media: ProductMediaRecord[];
};

export interface CatalogueAdminRepository {
  listCategories(): Promise<CategoryRecord[]>;
  listProducts(): Promise<ProductRecord[]>;
  getProductDetail(productId: string): Promise<AdminProductDetail | null>;
}

class FirestoreCatalogueAdminRepository
  implements CatalogueAdminRepository
{
  constructor(private readonly firestore: Firestore) {}

  async listCategories() {
    const categorySnapshot = await this.firestore
      .collection(firestoreCollections.categories)
      .limit(200)
      .get();

    return categorySnapshot.docs
      .map((categoryDocument) =>
        parseAdminRecord(
          categoryDocument,
          categoryDocumentSchema,
          'Category',
        ),
      )
      .sort(
        (leftCategory, rightCategory) =>
          leftCategory.displayOrder - rightCategory.displayOrder ||
          leftCategory.name.localeCompare(rightCategory.name, 'en-NG'),
      );
  }

  async listProducts() {
    const productSnapshot = await this.firestore
      .collection(firestoreCollections.products)
      .limit(300)
      .get();

    return productSnapshot.docs
      .map((productDocument) =>
        parseAdminRecord(
          productDocument,
          productDocumentSchema,
          'Product',
        ),
      )
      .sort(
        (leftProduct, rightProduct) =>
          leftProduct.publicationOrder - rightProduct.publicationOrder ||
          leftProduct.name.localeCompare(rightProduct.name, 'en-NG'),
      );
  }

  async getProductDetail(
    productId: string,
  ): Promise<AdminProductDetail | null> {
    const parsedProductId = parseDocumentId(productId);
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc(parsedProductId);
    const [productSnapshot, variantSnapshot, mediaSnapshot] =
      await Promise.all([
        productReference.get(),
        this.firestore
          .collection(firestoreCollections.productVariants)
          .where('productId', '==', parsedProductId)
          .get(),
        this.firestore
          .collection(firestoreCollections.productMedia)
          .where('productId', '==', parsedProductId)
          .get(),
      ]);

    if (!productSnapshot.exists) {
      return null;
    }

    return {
      product: parseAdminRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      ),
      variants: variantSnapshot.docs
        .map((variantDocument) =>
          parseAdminRecord(
            variantDocument,
            productVariantDocumentSchema,
            'Product variant',
          ),
        )
        .sort(
          (leftVariant, rightVariant) =>
            leftVariant.publicationOrder -
              rightVariant.publicationOrder ||
            leftVariant.name.localeCompare(rightVariant.name, 'en-NG'),
        ),
      media: mediaSnapshot.docs
        .map((mediaDocument) =>
          parseAdminRecord(
            mediaDocument,
            productMediaDocumentSchema,
            'Product media',
          ),
        )
        .sort(
          (leftMedia, rightMedia) =>
            leftMedia.sortOrder - rightMedia.sortOrder,
        ),
    };
  }
}

export function createCatalogueAdminRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
): CatalogueAdminRepository {
  return new FirestoreCatalogueAdminRepository(firestore);
}
