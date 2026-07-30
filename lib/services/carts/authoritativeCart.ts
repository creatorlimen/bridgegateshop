import 'server-only';

import { getCommerceDataSource } from '@/lib/config/commerceDataSource';
import {
  addPreviewCartItem,
  getPreviewCartLines,
  removePreviewCartItem,
  updatePreviewCartItem,
} from '@/lib/services/carts/previewCart';
import {
  CartMutationError,
  createCartService,
  type AuthoritativeCart,
} from '@/lib/services/carts/CartService';
import { getCartIdentity } from '@/lib/services/carts/cartSession';

export type CurrentCart = Omit<AuthoritativeCart, 'dataSource'> & {
  dataSource: 'placeholder' | 'firestore';
};

function getEmptyCart(
  dataSource: 'placeholder' | 'firestore',
): CurrentCart {
  return {
    id: null,
    version: null,
    lines: [],
    subtotalKobo: 0,
    currency: 'NGN',
    issues: [],
    mergeNotices: [],
    readyForCheckout: false,
    dataSource,
  };
}

export async function getCurrentCart(): Promise<CurrentCart> {
  if (getCommerceDataSource() === 'placeholder') {
    const previewLines = await getPreviewCartLines();
    const lines = previewLines.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      productSlug: line.productSlug,
      productName: line.productName,
      variantName: line.variantName,
      packageLabel: line.packageLabel,
      requestedQuantity: line.quantity,
      availableQuantity: null,
      imagePath: line.imagePath,
      imageAlt: line.imageAlt,
      unitPriceKobo: line.unitPriceKobo,
      previousUnitPriceKobo: line.unitPriceKobo,
      lineTotalKobo: line.lineTotalKobo,
      issues: [],
    }));

    return {
      ...getEmptyCart('placeholder'),
      lines,
      subtotalKobo: lines.reduce(
        (total, line) => total + line.lineTotalKobo,
        0,
      ),
      readyForCheckout: lines.length > 0,
    };
  }

  const identity = await getCartIdentity({ createIfMissing: false });

  if (!identity) {
    return getEmptyCart('firestore');
  }

  return createCartService().getCart(identity);
}

export async function addCurrentCartItem(
  variantId: string,
  quantity: number,
) {
  if (getCommerceDataSource() === 'placeholder') {
    return addPreviewCartItem(variantId, quantity);
  }

  const identity = await getCartIdentity({ createIfMissing: true });

  if (!identity) {
    throw new CartMutationError(
      'INTERNAL_ERROR',
      'Unable to establish a secure cart.',
    );
  }

  return createCartService().addItem(identity, variantId, quantity);
}

export async function updateCurrentCartItem(
  variantId: string,
  quantity: number,
) {
  if (getCommerceDataSource() === 'placeholder') {
    return updatePreviewCartItem(variantId, quantity);
  }

  const identity = await getCartIdentity({ createIfMissing: false });

  if (!identity) {
    throw new CartMutationError('NOT_FOUND', 'The cart was not found.');
  }

  return createCartService().updateItem(identity, variantId, quantity);
}

export async function removeCurrentCartItem(variantId: string) {
  if (getCommerceDataSource() === 'placeholder') {
    return removePreviewCartItem(variantId);
  }

  const identity = await getCartIdentity({ createIfMissing: false });

  if (!identity) {
    return { replay: true };
  }

  return createCartService().removeItem(identity, variantId);
}

export async function acknowledgeCurrentCartPrices() {
  if (getCommerceDataSource() === 'placeholder') {
    return;
  }

  const identity = await getCartIdentity({ createIfMissing: false });

  if (!identity) {
    throw new CartMutationError('NOT_FOUND', 'The cart was not found.');
  }

  return createCartService().acknowledgeCurrentPrices(identity);
}

export async function validateCurrentCartForCheckout() {
  if (getCommerceDataSource() === 'placeholder') {
    const cart = await getCurrentCart();

    if (cart.lines.length === 0) {
      throw new CartMutationError(
        'VALIDATION_FAILED',
        'Add at least one item before checkout.',
      );
    }

    return cart;
  }

  const identity = await getCartIdentity({ createIfMissing: false });

  if (!identity) {
    throw new CartMutationError('NOT_FOUND', 'The cart was not found.');
  }

  return createCartService().validateForCheckout(identity);
}
