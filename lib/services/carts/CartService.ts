import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import {
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import type { ZodType } from 'zod';

import type { DomainErrorCode } from '@/lib/actions/actionResult';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  productDocumentSchema,
  type ProductRecord,
  productVariantDocumentSchema,
  type ProductVariantRecord,
} from '@/lib/schemas/catalogue';
import {
  cartDocumentSchema,
  type CartItemDocument,
  cartItemDocumentSchema,
  type CartItemRecord,
  cartMutationInputSchema,
  type CartRecord,
} from '@/lib/schemas/cart';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import {
  inventoryBalanceDocumentSchema,
  type InventoryBalanceRecord,
} from '@/lib/schemas/inventory';

const maximumCartLines = 50;
const maximumLineQuantity = 100;
const cartLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export type CartIdentity = {
  cartId: string;
  ownerUid: string | null;
  guestTokenHash: string | null;
};

export type CartLineIssueCode =
  | 'PRICE_CHANGED'
  | 'OUT_OF_STOCK'
  | 'UNAVAILABLE';

export type AuthoritativeCartLine = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  packageLabel: string;
  requestedQuantity: number;
  availableQuantity: number | null;
  imagePath: string;
  imageAlt: string;
  unitPriceKobo: number;
  previousUnitPriceKobo: number;
  lineTotalKobo: number;
  issues: CartLineIssueCode[];
};

export type AuthoritativeCart = {
  id: string | null;
  version: number | null;
  lines: AuthoritativeCartLine[];
  subtotalKobo: number;
  currency: 'NGN';
  issues: Array<{
    code: CartLineIssueCode;
    variantId: string;
    message: string;
  }>;
  mergeNotices: CartRecord['mergeNotices'];
  readyForCheckout: boolean;
  dataSource: 'firestore';
};

type CommerceRecord = {
  item: CartItemRecord;
  variant: ProductVariantRecord | null;
  product: ProductRecord | null;
  balance: InventoryBalanceRecord | null;
};

export class CartMutationError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly fieldName?: string,
  ) {
    super(message);
    this.name = 'CartMutationError';
  }
}

function parseRecord<DocumentType>(
  snapshot: DocumentSnapshot,
  schema: ZodType<DocumentType>,
  entityLabel: string,
): DocumentType & { id: string } {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success) {
    throw new CartMutationError(
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

function safeHashEquals(leftValue: string, rightValue: string) {
  const leftBuffer = Buffer.from(leftValue, 'utf8');
  const rightBuffer = Buffer.from(rightValue, 'utf8');

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function assertCartOwner(cart: CartRecord, identity: CartIdentity) {
  const ownerMatches =
    identity.ownerUid !== null &&
    cart.ownerUid === identity.ownerUid &&
    cart.guestTokenHash === null;
  const guestMatches =
    identity.guestTokenHash !== null &&
    cart.ownerUid === null &&
    cart.guestTokenHash !== null &&
    safeHashEquals(cart.guestTokenHash, identity.guestTokenHash);

  if (!ownerMatches && !guestMatches) {
    throw new CartMutationError(
      'PERMISSION_DENIED',
      'The cart could not be verified.',
    );
  }
}

function assertActiveCart(cart: CartRecord, identity: CartIdentity) {
  assertCartOwner(cart, identity);

  if (
    cart.status !== 'active' ||
    firestoreTimestampToDate(cart.expiresAt).getTime() <= Date.now()
  ) {
    throw new CartMutationError(
      'INVALID_STATE',
      'This cart has expired. Start a new cart and try again.',
    );
  }
}

function getCartExpiry(now: Date) {
  return Timestamp.fromMillis(
    now.getTime() + cartLifetimeMilliseconds,
  );
}

function createCartDocument(
  identity: Omit<CartIdentity, 'cartId'>,
  now: Timestamp,
) {
  return cartDocumentSchema.parse({
    schemaVersion: 1,
    ownerUid: identity.ownerUid,
    guestTokenHash: identity.guestTokenHash,
    status: 'active',
    currency: 'NGN',
    expiresAt: getCartExpiry(now.toDate()),
    lastPricedAt: null,
    mergedIntoCartId: null,
    mergeNotices: [],
    createdAt: now,
    createdBy: identity.ownerUid ?? 'system:guest-cart',
    updatedAt: now,
    updatedBy: identity.ownerUid ?? 'system:guest-cart',
    version: 1,
  });
}

function getProductImagePath(product: ProductRecord) {
  return product.primaryMediaId
    ? `/api/media/catalogue/${product.primaryMediaId}?kind=card`
    : '/images/pop-paint-placeholder.png';
}

async function loadCommerceRecords(
  firestore: Firestore,
  items: readonly CartItemRecord[],
): Promise<CommerceRecord[]> {
  if (items.length === 0) {
    return [];
  }

  const variantSnapshots = await firestore.getAll(
    ...items.map((item) =>
      firestore
        .collection(firestoreCollections.productVariants)
        .doc(item.variantId),
    ),
  );
  const variants = variantSnapshots.map((snapshot) =>
    snapshot.exists
      ? parseRecord(
          snapshot,
          productVariantDocumentSchema,
          'Product variant',
        )
      : null,
  );
  const productIds = [
    ...new Set(
      variants
        .filter(
          (variant): variant is ProductVariantRecord =>
            variant !== null,
        )
        .map((variant) => variant.productId),
    ),
  ];
  const productSnapshots =
    productIds.length > 0
      ? await firestore.getAll(
          ...productIds.map((productId) =>
            firestore
              .collection(firestoreCollections.products)
              .doc(productId),
          ),
        )
      : [];
  const productsById = new Map(
    productSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const product = parseRecord(
          snapshot,
          productDocumentSchema,
          'Product',
        );
        return [product.id, product] as const;
      }),
  );
  const managedVariants = variants.filter(
    (variant): variant is ProductVariantRecord =>
      variant?.stockManaged === true,
  );
  const balanceSnapshots =
    managedVariants.length > 0
      ? await firestore.getAll(
          ...managedVariants.map((variant) =>
            firestore
              .collection(firestoreCollections.inventoryBalances)
              .doc(variant.id),
          ),
        )
      : [];
  const balancesByVariantId = new Map(
    balanceSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const balance = parseRecord(
          snapshot,
          inventoryBalanceDocumentSchema,
          'Inventory balance',
        );
        return [balance.variantId, balance] as const;
      }),
  );

  return items.map((item, itemIndex) => {
    const variant = variants[itemIndex];

    return {
      item,
      variant,
      product: variant
        ? productsById.get(variant.productId) ?? null
        : null,
      balance: variant?.stockManaged
        ? balancesByVariantId.get(variant.id) ?? null
        : null,
    };
  });
}

function toAuthoritativeCart(
  cart: CartRecord,
  commerceRecords: readonly CommerceRecord[],
): AuthoritativeCart {
  const issues: AuthoritativeCart['issues'] = [];
  const lines = commerceRecords.map(
    ({ item, variant, product, balance }) => {
      const lineIssues: CartLineIssueCode[] = [];
      const productIsPurchasable =
        product?.status === 'active' &&
        variant?.status === 'active' &&
        variant.productId === product.id;

      if (!variant || !product || !productIsPurchasable) {
        lineIssues.push('UNAVAILABLE');
      }

      const availableQuantity =
        variant?.stockManaged === true ? balance?.available ?? 0 : null;

      if (
        variant?.stockManaged === true &&
        (availableQuantity === 0 ||
          item.requestedQuantity > (availableQuantity ?? 0))
      ) {
        lineIssues.push('OUT_OF_STOCK');
      }

      const currentUnitPriceKobo =
        variant?.priceKobo ?? item.lastDisplayedUnitPriceKobo;

      if (
        variant &&
        currentUnitPriceKobo !== item.lastDisplayedUnitPriceKobo
      ) {
        lineIssues.push('PRICE_CHANGED');
      }

      for (const issueCode of lineIssues) {
        const message =
          issueCode === 'PRICE_CHANGED'
            ? 'The current server price changed after this item was added.'
            : issueCode === 'OUT_OF_STOCK'
              ? 'The requested quantity is no longer available.'
              : 'This product variant is no longer purchasable.';

        issues.push({
          code: issueCode,
          variantId: item.variantId,
          message,
        });
      }

      return {
        variantId: item.variantId,
        productId: product?.id ?? item.productId,
        productSlug: product?.slug ?? '',
        productName: product?.name ?? 'Unavailable product',
        variantName: variant?.name ?? 'Unavailable variant',
        packageLabel: variant?.packageLabel ?? 'Unavailable',
        requestedQuantity: item.requestedQuantity,
        availableQuantity,
        imagePath: product
          ? getProductImagePath(product)
          : '/images/pop-paint-placeholder.png',
        imageAlt: product
          ? `${product.name} product image`
          : 'Unavailable product',
        unitPriceKobo: currentUnitPriceKobo,
        previousUnitPriceKobo: item.lastDisplayedUnitPriceKobo,
        lineTotalKobo:
          currentUnitPriceKobo * item.requestedQuantity,
        issues: lineIssues,
      };
    },
  );
  const subtotalKobo = lines.reduce(
    (total, line) => total + line.lineTotalKobo,
    0,
  );

  return {
    id: cart.id,
    version: cart.version,
    lines,
    subtotalKobo,
    currency: 'NGN',
    issues,
    mergeNotices: cart.mergeNotices,
    readyForCheckout: lines.length > 0 && issues.length === 0,
    dataSource: 'firestore',
  };
}

async function loadTransactionCommerceRecords(
  transaction: Transaction,
  firestore: Firestore,
  items: readonly CartItemRecord[],
): Promise<CommerceRecord[]> {
  if (items.length === 0) {
    return [];
  }

  const variantSnapshots = await transaction.getAll(
    ...items.map((item) =>
      firestore
        .collection(firestoreCollections.productVariants)
        .doc(item.variantId),
    ),
  );
  const variants = variantSnapshots.map((snapshot) =>
    snapshot.exists
      ? parseRecord(
          snapshot,
          productVariantDocumentSchema,
          'Product variant',
        )
      : null,
  );
  const productSnapshots = await transaction.getAll(
    ...items.map((item) =>
      firestore
        .collection(firestoreCollections.products)
        .doc(item.productId),
    ),
  );
  const balanceSnapshots = await transaction.getAll(
    ...items.map((item) =>
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(item.variantId),
    ),
  );

  return items.map((item, itemIndex) => {
    const variant = variants[itemIndex];
    const productSnapshot = productSnapshots[itemIndex];
    const product = productSnapshot.exists
      ? parseRecord(
          productSnapshot,
          productDocumentSchema,
          'Product',
        )
      : null;
    const balanceSnapshot = balanceSnapshots[itemIndex];
    const balance =
      variant?.stockManaged === true && balanceSnapshot.exists
        ? parseRecord(
            balanceSnapshot,
            inventoryBalanceDocumentSchema,
            'Inventory balance',
          )
        : null;

    return { item, variant, product, balance };
  });
}

class FirestoreCartService {
  constructor(private readonly firestore: Firestore) {}

  async findActiveCustomerCart(
    ownerUid: string,
  ): Promise<CartIdentity | null> {
    const cartSnapshot = await this.firestore
      .collection(firestoreCollections.carts)
      .where('ownerUid', '==', ownerUid)
      .where('status', '==', 'active')
      .limit(5)
      .get();
    const activeCarts = cartSnapshot.docs
      .map((snapshot) =>
        parseRecord(snapshot, cartDocumentSchema, 'Cart'),
      )
      .filter(
        (cart) =>
          firestoreTimestampToDate(cart.expiresAt).getTime() > Date.now(),
      );

    if (activeCarts.length > 1) {
      throw new CartMutationError(
        'INVALID_STATE',
        'The customer has multiple active carts.',
      );
    }

    const cart = activeCarts[0];

    return cart
      ? {
          cartId: cart.id,
          ownerUid,
          guestTokenHash: null,
        }
      : null;
  }

  async getOrCreateCustomerCart(ownerUid: string) {
    const newCartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc();

    return this.firestore.runTransaction(async (transaction) => {
      const activeCartQuery = this.firestore
        .collection(firestoreCollections.carts)
        .where('ownerUid', '==', ownerUid)
        .where('status', '==', 'active')
        .limit(5);
      const activeCartSnapshot =
        await transaction.get(activeCartQuery);
      const activeCarts = activeCartSnapshot.docs.map((snapshot) =>
        parseRecord(snapshot, cartDocumentSchema, 'Cart'),
      );
      const now = Timestamp.now();
      const currentCart = activeCarts.find(
        (cart) =>
          firestoreTimestampToDate(cart.expiresAt).getTime() >
          now.toMillis(),
      );

      if (currentCart) {
        if (
          activeCarts.filter(
            (cart) =>
              firestoreTimestampToDate(cart.expiresAt).getTime() >
              now.toMillis(),
          ).length > 1
        ) {
          throw new CartMutationError(
            'INVALID_STATE',
            'The customer has multiple active carts.',
          );
        }

        return {
          cartId: currentCart.id,
          ownerUid,
          guestTokenHash: null,
        };
      }

      for (const expiredCart of activeCarts) {
        transaction.set(
          this.firestore
            .collection(firestoreCollections.carts)
            .doc(expiredCart.id),
          cartDocumentSchema.parse({
            ...expiredCart,
            status: 'expired',
            updatedAt: now,
            updatedBy: ownerUid,
            version: expiredCart.version + 1,
          }),
        );
      }

      transaction.create(
        newCartReference,
        createCartDocument(
          { ownerUid, guestTokenHash: null },
          now,
        ),
      );

      return {
        cartId: newCartReference.id,
        ownerUid,
        guestTokenHash: null,
      };
    });
  }

  async createGuestCart(guestTokenHash: string): Promise<CartIdentity> {
    const cartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc();
    const now = Timestamp.now();

    await cartReference.create(
      createCartDocument(
        { ownerUid: null, guestTokenHash },
        now,
      ),
    );

    return {
      cartId: cartReference.id,
      ownerUid: null,
      guestTokenHash,
    };
  }

  async verifyGuestCart(
    cartId: string,
    guestTokenHash: string,
  ): Promise<CartIdentity | null> {
    const cartSnapshot = await this.firestore
      .collection(firestoreCollections.carts)
      .doc(cartId)
      .get();

    if (!cartSnapshot.exists) {
      return null;
    }

    const cart = parseRecord(
      cartSnapshot,
      cartDocumentSchema,
      'Cart',
    );

    try {
      assertActiveCart(cart, {
        cartId,
        ownerUid: null,
        guestTokenHash,
      });
      return { cartId, ownerUid: null, guestTokenHash };
    } catch {
      return null;
    }
  }

  async getCart(identity: CartIdentity): Promise<AuthoritativeCart> {
    const cartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc(identity.cartId);
    const [cartSnapshot, itemSnapshot] = await Promise.all([
      cartReference.get(),
      cartReference
        .collection(firestoreCollections.cartItems)
        .limit(maximumCartLines)
        .get(),
    ]);
    const cart = parseRecord(
      cartSnapshot,
      cartDocumentSchema,
      'Cart',
    );
    assertActiveCart(cart, identity);
    const items = itemSnapshot.docs.map((snapshot) =>
      parseRecord(snapshot, cartItemDocumentSchema, 'Cart item'),
    );
    const commerceRecords = await loadCommerceRecords(
      this.firestore,
      items,
    );

    return toAuthoritativeCart(cart, commerceRecords);
  }

  async addItem(
    identity: CartIdentity,
    variantId: string,
    quantity: number,
  ) {
    const input = cartMutationInputSchema.parse({
      variantId,
      quantity,
    });
    return this.setItemQuantity(identity, input.variantId, input.quantity, true);
  }

  async updateItem(
    identity: CartIdentity,
    variantId: string,
    quantity: number,
  ) {
    const input = cartMutationInputSchema.parse({
      variantId,
      quantity,
    });
    return this.setItemQuantity(
      identity,
      input.variantId,
      input.quantity,
      false,
    );
  }

  private async setItemQuantity(
    identity: CartIdentity,
    variantId: string,
    quantity: number,
    isAddition: boolean,
  ) {
    const cartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc(identity.cartId);
    const itemReference = cartReference
      .collection(firestoreCollections.cartItems)
      .doc(variantId);
    const variantReference = this.firestore
      .collection(firestoreCollections.productVariants)
      .doc(variantId);
    const balanceReference = this.firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(variantId);

    return this.firestore.runTransaction(async (transaction) => {
      const [
        cartSnapshot,
        itemSnapshot,
        variantSnapshot,
        balanceSnapshot,
      ] = await transaction.getAll(
        cartReference,
        itemReference,
        variantReference,
        balanceReference,
      );
      const cart = parseRecord(
        cartSnapshot,
        cartDocumentSchema,
        'Cart',
      );
      assertActiveCart(cart, identity);
      const variant = parseRecord(
        variantSnapshot,
        productVariantDocumentSchema,
        'Product variant',
      );
      const productSnapshot = await transaction.get(
        this.firestore
          .collection(firestoreCollections.products)
          .doc(variant.productId),
      );
      const product = parseRecord(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );

      if (
        variant.status !== 'active' ||
        product.status !== 'active'
      ) {
        throw new CartMutationError(
          'INVALID_STATE',
          'The selected product variant is unavailable.',
        );
      }

      const existingItem = itemSnapshot.exists
        ? parseRecord(
            itemSnapshot,
            cartItemDocumentSchema,
            'Cart item',
          )
        : null;

      if (!isAddition && !existingItem) {
        throw new CartMutationError(
          'NOT_FOUND',
          'The selected cart item was not found.',
        );
      }

      const requestedQuantity = isAddition
        ? (existingItem?.requestedQuantity ?? 0) + quantity
        : quantity;

      if (requestedQuantity > maximumLineQuantity) {
        throw new CartMutationError(
          'VALIDATION_FAILED',
          `A cart line can contain at most ${maximumLineQuantity} units.`,
          'quantity',
        );
      }

      if (variant.stockManaged) {
        const balance = balanceSnapshot.exists
          ? parseRecord(
              balanceSnapshot,
              inventoryBalanceDocumentSchema,
              'Inventory balance',
            )
          : null;

        if (!balance || balance.available < requestedQuantity) {
          throw new CartMutationError(
            'OUT_OF_STOCK',
            'The requested quantity is no longer available.',
            'quantity',
          );
        }
      }

      if (!existingItem) {
        const itemCountSnapshot = await transaction.get(
          cartReference
            .collection(firestoreCollections.cartItems)
            .limit(maximumCartLines),
        );

        if (itemCountSnapshot.size >= maximumCartLines) {
          throw new CartMutationError(
            'VALIDATION_FAILED',
            'A cart can contain at most 50 different variants.',
          );
        }
      }

      const now = Timestamp.now();
      const itemDocument: CartItemDocument =
        cartItemDocumentSchema.parse({
          schemaVersion: 1,
          productId: product.id,
          variantId: variant.id,
          requestedQuantity,
          lastDisplayedUnitPriceKobo: variant.priceKobo,
          currency: 'NGN',
          addedAt: existingItem?.addedAt ?? now,
          updatedAt: now,
        });
      const updatedCart = cartDocumentSchema.parse({
        ...cart,
        expiresAt: getCartExpiry(now.toDate()),
        lastPricedAt: now,
        mergeNotices: [],
        updatedAt: now,
        updatedBy: identity.ownerUid ?? 'system:guest-cart',
        version: cart.version + 1,
      });

      transaction.set(itemReference, itemDocument);
      transaction.set(cartReference, updatedCart);

      return {
        cart: { id: cart.id, ...updatedCart },
        item: { id: variant.id, ...itemDocument },
      };
    });
  }

  async removeItem(identity: CartIdentity, variantId: string) {
    const parsedVariantId = cartMutationInputSchema.shape.variantId.parse(
      variantId,
    );
    const cartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc(identity.cartId);
    const itemReference = cartReference
      .collection(firestoreCollections.cartItems)
      .doc(parsedVariantId);

    return this.firestore.runTransaction(async (transaction) => {
      const [cartSnapshot, itemSnapshot] = await transaction.getAll(
        cartReference,
        itemReference,
      );
      const cart = parseRecord(
        cartSnapshot,
        cartDocumentSchema,
        'Cart',
      );
      assertActiveCart(cart, identity);

      if (!itemSnapshot.exists) {
        return { replay: true };
      }

      const now = Timestamp.now();
      transaction.delete(itemReference);
      transaction.set(
        cartReference,
        cartDocumentSchema.parse({
          ...cart,
          mergeNotices: [],
          updatedAt: now,
          updatedBy:
            identity.ownerUid ?? 'system:guest-cart',
          version: cart.version + 1,
        }),
      );

      return { replay: false };
    });
  }

  async acknowledgeCurrentPrices(identity: CartIdentity) {
    const cartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc(identity.cartId);

    return this.firestore.runTransaction(async (transaction) => {
      const [cartSnapshot, itemSnapshot] = await Promise.all([
        transaction.get(cartReference),
        transaction.get(
          cartReference
            .collection(firestoreCollections.cartItems)
            .limit(maximumCartLines),
        ),
      ]);
      const cart = parseRecord(
        cartSnapshot,
        cartDocumentSchema,
        'Cart',
      );
      assertActiveCart(cart, identity);
      const items = itemSnapshot.docs.map((snapshot) =>
        parseRecord(snapshot, cartItemDocumentSchema, 'Cart item'),
      );
      const commerceRecords = await loadTransactionCommerceRecords(
        transaction,
        this.firestore,
        items,
      );
      const now = Timestamp.now();

      for (const { item, variant, product, balance } of commerceRecords) {
        if (
          !variant ||
          !product ||
          variant.productId !== product.id ||
          variant.status !== 'active' ||
          product.status !== 'active'
        ) {
          throw new CartMutationError(
            'INVALID_STATE',
            'Remove unavailable items before continuing.',
          );
        }

        if (
          variant.stockManaged &&
          (!balance ||
            balance.available < item.requestedQuantity)
        ) {
          throw new CartMutationError(
            'OUT_OF_STOCK',
            'Adjust unavailable quantities before continuing.',
          );
        }

        transaction.set(
          cartReference
            .collection(firestoreCollections.cartItems)
            .doc(item.variantId),
          cartItemDocumentSchema.parse({
            schemaVersion: item.schemaVersion,
            productId: item.productId,
            variantId: item.variantId,
            requestedQuantity: item.requestedQuantity,
            currency: item.currency,
            addedAt: item.addedAt,
            lastDisplayedUnitPriceKobo: variant.priceKobo,
            updatedAt: now,
          }),
        );
      }

      transaction.set(
        cartReference,
        cartDocumentSchema.parse({
          ...cart,
          lastPricedAt: now,
          mergeNotices: [],
          updatedAt: now,
          updatedBy:
            identity.ownerUid ?? 'system:guest-cart',
          version: cart.version + 1,
        }),
      );
    });
  }

  async validateForCheckout(identity: CartIdentity) {
    const cart = await this.getCart(identity);

    if (cart.lines.length === 0) {
      throw new CartMutationError(
        'VALIDATION_FAILED',
        'Add at least one item before checkout.',
      );
    }

    const priceIssue = cart.issues.find(
      (issue) => issue.code === 'PRICE_CHANGED',
    );

    if (priceIssue) {
      throw new CartMutationError(
        'PRICE_CHANGED',
        'Review and accept the current prices before checkout.',
      );
    }

    const stockIssue = cart.issues.find(
      (issue) => issue.code === 'OUT_OF_STOCK',
    );

    if (stockIssue) {
      throw new CartMutationError(
        'OUT_OF_STOCK',
        'Adjust unavailable quantities before checkout.',
      );
    }

    if (cart.issues.length > 0) {
      throw new CartMutationError(
        'INVALID_STATE',
        'Remove unavailable items before checkout.',
      );
    }

    return cart;
  }

  async mergeGuestCart(
    guestIdentity: CartIdentity,
    ownerUid: string,
  ): Promise<{
    identity: CartIdentity;
    notices: CartRecord['mergeNotices'];
    replay: boolean;
  }> {
    if (!guestIdentity.guestTokenHash) {
      throw new CartMutationError(
        'VALIDATION_FAILED',
        'A verified guest cart is required for merge.',
      );
    }

    const guestCartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc(guestIdentity.cartId);
    const newCustomerCartReference = this.firestore
      .collection(firestoreCollections.carts)
      .doc();

    return this.firestore.runTransaction(async (transaction) => {
      const activeCustomerCartQuery = this.firestore
        .collection(firestoreCollections.carts)
        .where('ownerUid', '==', ownerUid)
        .where('status', '==', 'active')
        .limit(2);
      const [
        guestCartSnapshot,
        guestItemsSnapshot,
        customerCartSnapshot,
      ] = await Promise.all([
        transaction.get(guestCartReference),
        transaction.get(
          guestCartReference
            .collection(firestoreCollections.cartItems)
            .limit(maximumCartLines),
        ),
        transaction.get(activeCustomerCartQuery),
      ]);
      const guestCart = parseRecord(
        guestCartSnapshot,
        cartDocumentSchema,
        'Guest cart',
      );
      assertCartOwner(guestCart, guestIdentity);

      if (guestCart.status === 'merged' && guestCart.mergedIntoCartId) {
        return {
          identity: {
            cartId: guestCart.mergedIntoCartId,
            ownerUid,
            guestTokenHash: null,
          },
          notices: [],
          replay: true,
        };
      }

      assertActiveCart(guestCart, guestIdentity);

      if (customerCartSnapshot.size > 1) {
        throw new CartMutationError(
          'INVALID_STATE',
          'The customer has multiple active carts.',
        );
      }

      const now = Timestamp.now();
      const customerCartDocument = customerCartSnapshot.docs[0];
      const customerCart = customerCartDocument
        ? parseRecord(
            customerCartDocument,
            cartDocumentSchema,
            'Customer cart',
          )
        : null;
      const targetCartReference = customerCartDocument
        ? customerCartDocument.ref
        : newCustomerCartReference;
      const targetCart = customerCart ?? {
        id: targetCartReference.id,
        ...createCartDocument(
          { ownerUid, guestTokenHash: null },
          now,
        ),
      };

      if (customerCart) {
        assertActiveCart(customerCart, {
          cartId: customerCart.id,
          ownerUid,
          guestTokenHash: null,
        });
      }

      const targetItemsSnapshot = await transaction.get(
        targetCartReference
          .collection(firestoreCollections.cartItems)
          .limit(maximumCartLines),
      );
      const guestItems = guestItemsSnapshot.docs.map((snapshot) =>
        parseRecord(snapshot, cartItemDocumentSchema, 'Guest cart item'),
      );
      const targetItems = targetItemsSnapshot.docs.map((snapshot) =>
        parseRecord(
          snapshot,
          cartItemDocumentSchema,
          'Customer cart item',
        ),
      );
      const combinedItems = new Map(
        targetItems.map((item) => [item.variantId, item]),
      );

      for (const guestItem of guestItems) {
        const targetItem = combinedItems.get(guestItem.variantId);
        combinedItems.set(guestItem.variantId, {
          ...guestItem,
          requestedQuantity:
            guestItem.requestedQuantity +
            (targetItem?.requestedQuantity ?? 0),
          addedAt: targetItem?.addedAt ?? guestItem.addedAt,
        });
      }

      const boundedItems = [...combinedItems.values()].slice(
        0,
        maximumCartLines,
      );
      const commerceRecords = await loadTransactionCommerceRecords(
        transaction,
        this.firestore,
        boundedItems,
      );
      const notices: CartRecord['mergeNotices'] = [];

      for (const { item, variant, product, balance } of commerceRecords) {
        const requestedQuantity = item.requestedQuantity;
        const maximumAvailable = variant?.stockManaged
          ? balance?.available ?? 0
          : maximumLineQuantity;
        const acceptedQuantity = Math.min(
          requestedQuantity,
          maximumLineQuantity,
          maximumAvailable,
        );

        if (
          !variant ||
          !product ||
          variant.productId !== product.id ||
          variant.status !== 'active' ||
          product.status !== 'active' ||
          acceptedQuantity < 1
        ) {
          notices.push({
            variantId: item.variantId,
            code: 'UNAVAILABLE',
            requestedQuantity: Math.min(requestedQuantity, 200),
            acceptedQuantity: 0,
          });
          continue;
        }

        if (acceptedQuantity !== requestedQuantity) {
          notices.push({
            variantId: item.variantId,
            code: 'QUANTITY_ADJUSTED',
            requestedQuantity: Math.min(requestedQuantity, 200),
            acceptedQuantity,
          });
        }

        transaction.set(
          targetCartReference
            .collection(firestoreCollections.cartItems)
            .doc(item.variantId),
          cartItemDocumentSchema.parse({
            schemaVersion: item.schemaVersion,
            variantId: item.variantId,
            currency: item.currency,
            addedAt: item.addedAt,
            productId: product.id,
            requestedQuantity: acceptedQuantity,
            lastDisplayedUnitPriceKobo: variant.priceKobo,
            updatedAt: now,
          }),
        );
      }

      for (const notice of notices) {
        if (notice.acceptedQuantity === 0) {
          transaction.delete(
            targetCartReference
              .collection(firestoreCollections.cartItems)
              .doc(notice.variantId),
          );
        }
      }

      const updatedTargetCart = cartDocumentSchema.parse({
        ...targetCart,
        expiresAt: getCartExpiry(now.toDate()),
        lastPricedAt: now,
        mergeNotices: notices,
        updatedAt: now,
        updatedBy: ownerUid,
        version: customerCart ? customerCart.version + 1 : 1,
      });
      const mergedGuestCart = cartDocumentSchema.parse({
        ...guestCart,
        status: 'merged',
        mergedIntoCartId: targetCartReference.id,
        updatedAt: now,
        updatedBy: ownerUid,
        version: guestCart.version + 1,
      });

      if (customerCart) {
        transaction.set(targetCartReference, updatedTargetCart);
      } else {
        transaction.create(targetCartReference, updatedTargetCart);
      }

      transaction.set(guestCartReference, mergedGuestCart);

      return {
        identity: {
          cartId: targetCartReference.id,
          ownerUid,
          guestTokenHash: null,
        },
        notices,
        replay: false,
      };
    });
  }
}

export type CartService = FirestoreCartService;

export function createCartService(
  firestore: Firestore = getFirebaseAdminFirestore(),
): CartService {
  return new FirestoreCartService(firestore);
}
