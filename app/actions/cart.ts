'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  addPreviewCartItem,
  removePreviewCartItem,
  updatePreviewCartItem,
} from '@/lib/services/carts/previewCart';

const cartMutationSchema = z.object({
  variantId: z.string().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(100),
});

export async function addCartItemAction(formData: FormData) {
  const input = cartMutationSchema.parse({
    variantId: formData.get('variantId'),
    quantity: formData.get('quantity'),
  });

  await addPreviewCartItem(input.variantId, input.quantity);
  revalidatePath('/cart');
  redirect('/cart');
}

export async function updateCartItemAction(formData: FormData) {
  const input = cartMutationSchema.parse({
    variantId: formData.get('variantId'),
    quantity: formData.get('quantity'),
  });

  await updatePreviewCartItem(input.variantId, input.quantity);
  revalidatePath('/cart');
  redirect('/cart');
}

export async function removeCartItemAction(formData: FormData) {
  const variantId = z.string().min(1).max(120).parse(formData.get('variantId'));

  await removePreviewCartItem(variantId);
  revalidatePath('/cart');
  redirect('/cart');
}
