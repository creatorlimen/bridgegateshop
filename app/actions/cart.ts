'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  acknowledgeCurrentCartPrices,
  addCurrentCartItem,
  removeCurrentCartItem,
  updateCurrentCartItem,
} from '@/lib/services/carts/authoritativeCart';
import { CartMutationError } from '@/lib/services/carts/CartService';

const cartMutationSchema = z.object({
  variantId: z.string().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(100),
});

function redirectToCartError(error: unknown): never {
  const errorMessage =
    error instanceof CartMutationError || error instanceof z.ZodError
      ? error instanceof CartMutationError
        ? error.message
        : 'Review the requested cart quantity and try again.'
      : 'The cart could not be updated safely. Please try again.';
  const searchParameters = new URLSearchParams({
    error: errorMessage,
  });

  redirect(`/cart?${searchParameters.toString()}`);
}

export async function addCartItemAction(formData: FormData) {
  const input = cartMutationSchema.parse({
    variantId: formData.get('variantId'),
    quantity: formData.get('quantity'),
  });

  try {
    await addCurrentCartItem(input.variantId, input.quantity);
  } catch (error) {
    redirectToCartError(error);
  }

  revalidatePath('/cart');
  redirect('/cart');
}

export async function updateCartItemAction(formData: FormData) {
  const input = cartMutationSchema.parse({
    variantId: formData.get('variantId'),
    quantity: formData.get('quantity'),
  });

  try {
    await updateCurrentCartItem(input.variantId, input.quantity);
  } catch (error) {
    redirectToCartError(error);
  }

  revalidatePath('/cart');
  redirect('/cart');
}

export async function removeCartItemAction(formData: FormData) {
  const variantId = z.string().min(1).max(120).parse(formData.get('variantId'));

  try {
    await removeCurrentCartItem(variantId);
  } catch (error) {
    redirectToCartError(error);
  }

  revalidatePath('/cart');
  redirect('/cart');
}

export async function acknowledgeCartPricesAction() {
  try {
    await acknowledgeCurrentCartPrices();
  } catch (error) {
    redirectToCartError(error);
  }

  revalidatePath('/cart');
  redirect('/cart');
}
