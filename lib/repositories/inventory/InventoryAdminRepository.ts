import 'server-only';

import type {
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';
import type { ZodType } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  productDocumentSchema,
  type ProductRecord,
  productVariantDocumentSchema,
  type ProductVariantRecord,
} from '@/lib/schemas/catalogue';
import {
  inventoryBalanceDocumentSchema,
  type InventoryBalanceRecord,
  inventoryMovementDocumentSchema,
  type InventoryMovementDocument,
  inventoryReservationDocumentSchema,
  type InventoryReservationRecord,
} from '@/lib/schemas/inventory';

function parseRecord<DocumentType>(
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

export type AdminInventoryLine = {
  variant: ProductVariantRecord;
  product: ProductRecord;
  balance: InventoryBalanceRecord | null;
};

export type AdminInventorySnapshot = {
  lines: AdminInventoryLine[];
  activeReservations: InventoryReservationRecord[];
  recentMovements: Array<InventoryMovementDocument & { id: string }>;
};

class FirestoreInventoryAdminRepository {
  constructor(private readonly firestore: Firestore) {}

  async getSnapshot(): Promise<AdminInventorySnapshot> {
    const [
      variantSnapshot,
      productSnapshot,
      balanceSnapshot,
      reservationSnapshot,
      movementSnapshot,
    ] = await Promise.all([
      this.firestore
        .collection(firestoreCollections.productVariants)
        .limit(500)
        .get(),
      this.firestore
        .collection(firestoreCollections.products)
        .limit(300)
        .get(),
      this.firestore
        .collection(firestoreCollections.inventoryBalances)
        .limit(500)
        .get(),
      this.firestore
        .collection(firestoreCollections.inventoryReservations)
        .where('state', '==', 'active')
        .orderBy('expiresAt', 'asc')
        .limit(100)
        .get(),
      this.firestore
        .collection(firestoreCollections.inventoryMovements)
        .orderBy('occurredAt', 'desc')
        .limit(100)
        .get(),
    ]);
    const productsById = new Map(
      productSnapshot.docs.map((snapshot) => {
        const product = parseRecord(
          snapshot,
          productDocumentSchema,
          'Product',
        );
        return [product.id, product] as const;
      }),
    );
    const balancesByVariantId = new Map(
      balanceSnapshot.docs.map((snapshot) => {
        const balance = parseRecord(
          snapshot,
          inventoryBalanceDocumentSchema,
          'Inventory balance',
        );
        return [balance.variantId, balance] as const;
      }),
    );
    const lines = variantSnapshot.docs
      .map((snapshot) =>
        parseRecord(
          snapshot,
          productVariantDocumentSchema,
          'Product variant',
        ),
      )
      .flatMap((variant) => {
        const product = productsById.get(variant.productId);

        return product
          ? [
              {
                variant,
                product,
                balance:
                  balancesByVariantId.get(variant.id) ?? null,
              },
            ]
          : [];
      })
      .sort(
        (leftLine, rightLine) =>
          leftLine.product.name.localeCompare(
            rightLine.product.name,
            'en-NG',
          ) ||
          leftLine.variant.name.localeCompare(
            rightLine.variant.name,
            'en-NG',
          ),
      );

    return {
      lines,
      activeReservations: reservationSnapshot.docs.map((snapshot) =>
        parseRecord(
          snapshot,
          inventoryReservationDocumentSchema,
          'Inventory reservation',
        ),
      ),
      recentMovements: movementSnapshot.docs.map((snapshot) =>
        parseRecord(
          snapshot,
          inventoryMovementDocumentSchema,
          'Inventory movement',
        ),
      ),
    };
  }
}

export type InventoryAdminRepository =
  FirestoreInventoryAdminRepository;

export function createInventoryAdminRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreInventoryAdminRepository(firestore);
}
