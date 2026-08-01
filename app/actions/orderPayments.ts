'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { loadCheckoutSettings } from '@/lib/config/checkoutSettings';
import { getOrderAccessProof } from '@/lib/services/carts/cartSession';
import { createRefundService } from '@/lib/services/payments/RefundService';
import { parseNairaToKobo } from '@/lib/utils/money/parseNairaToKobo';

function required(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export async function requestRefundAction(formData: FormData) {
  const proof = await getOrderAccessProof();
  const orderReference = required(formData, 'orderReference');
  if (!proof) redirect(`/orders/${orderReference}/confirmation?refund=access-denied`);
  const settings = await loadCheckoutSettings();
  await createRefundService(undefined, undefined, settings).requestRefund(
    {
      orderId: required(formData, 'orderId'),
      paymentId: required(formData, 'paymentId'),
      amountKobo: parseNairaToKobo(required(formData, 'amountNaira')),
      reason: required(formData, 'reason'),
      idempotencyKey: required(formData, 'idempotencyKey'),
    },
    proof,
  );
  revalidatePath(`/orders/${orderReference}/confirmation`);
  redirect(`/orders/${orderReference}/confirmation?refund=requested`);
}
