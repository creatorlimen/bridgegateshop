import { cookies } from 'next/headers';

import { products } from '@/lib/data/placeholder-catalogue';

const previewCartCookieName = 'bridgegate_preview_cart';
const maximumCartLines = 50;
const maximumLineQuantity = 100;

type PreviewCartItem = {
  variantId: string;
  quantity: number;
};

export type PreviewCartLine = PreviewCartItem & {
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  packageLabel: string;
  imagePath: string;
  imageAlt: string;
  unitPriceKobo: number;
  lineTotalKobo: number;
};

function isPreviewCartItem(value: unknown): value is PreviewCartItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const possibleCartItem = value as Partial<PreviewCartItem>;

  return (
    typeof possibleCartItem.variantId === 'string' &&
    Number.isSafeInteger(possibleCartItem.quantity) &&
    Number(possibleCartItem.quantity) > 0 &&
    Number(possibleCartItem.quantity) <= maximumLineQuantity
  );
}

async function readPreviewCartItems(): Promise<PreviewCartItem[]> {
  const cookieStore = await cookies();
  const storedCart = cookieStore.get(previewCartCookieName)?.value;

  if (!storedCart) {
    return [];
  }

  try {
    const parsedCart: unknown = JSON.parse(storedCart);

    if (!Array.isArray(parsedCart)) {
      return [];
    }

    return parsedCart.filter(isPreviewCartItem).slice(0, maximumCartLines);
  } catch {
    return [];
  }
}

async function writePreviewCartItems(cartItems: PreviewCartItem[]) {
  const cookieStore = await cookies();
  cookieStore.set(previewCartCookieName, JSON.stringify(cartItems), {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function findVariant(variantId: string) {
  for (const product of products) {
    const productVariant = product.variants.find(
      (variant) => variant.id === variantId,
    );

    if (productVariant) {
      return { product, productVariant };
    }
  }

  return undefined;
}

export async function addPreviewCartItem(variantId: string, quantity: number) {
  const catalogueEntry = findVariant(variantId);

  if (!catalogueEntry || catalogueEntry.productVariant.stockState === 'outOfStock') {
    throw new Error('The selected product variant is unavailable.');
  }

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > maximumLineQuantity
  ) {
    throw new Error('Quantity must be between 1 and 100.');
  }

  const cartItems = await readPreviewCartItems();
  const existingItem = cartItems.find(
    (cartItem) => cartItem.variantId === variantId,
  );

  if (existingItem) {
    existingItem.quantity = Math.min(
      maximumLineQuantity,
      existingItem.quantity + quantity,
    );
  } else {
    cartItems.push({ variantId, quantity });
  }

  await writePreviewCartItems(cartItems);
}

export async function updatePreviewCartItem(
  variantId: string,
  quantity: number,
) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > maximumLineQuantity
  ) {
    throw new Error('Quantity must be between 1 and 100.');
  }

  const cartItems = await readPreviewCartItems();
  const existingItem = cartItems.find(
    (cartItem) => cartItem.variantId === variantId,
  );

  if (!existingItem || !findVariant(variantId)) {
    throw new Error('The selected cart item is unavailable.');
  }

  existingItem.quantity = quantity;
  await writePreviewCartItems(cartItems);
}

export async function removePreviewCartItem(variantId: string) {
  const remainingItems = (await readPreviewCartItems()).filter(
    (cartItem) => cartItem.variantId !== variantId,
  );

  await writePreviewCartItems(remainingItems);
}

export async function getPreviewCartLines(): Promise<PreviewCartLine[]> {
  const cartItems = await readPreviewCartItems();

  return cartItems.flatMap((cartItem) => {
    const catalogueEntry = findVariant(cartItem.variantId);

    if (!catalogueEntry) {
      return [];
    }

    const { product, productVariant } = catalogueEntry;

    return [
      {
        ...cartItem,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        variantName: productVariant.name,
        packageLabel: productVariant.packageLabel,
        imagePath: product.imagePath,
        imageAlt: product.imageAlt,
        unitPriceKobo: productVariant.priceKobo,
        lineTotalKobo: productVariant.priceKobo * cartItem.quantity,
      },
    ];
  });
}
