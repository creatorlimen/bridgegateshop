'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getCommerceDataSource } from '@/lib/config/commerceDataSource';
import { getCheckoutIdentity } from '@/lib/services/carts/cartSession';
import {
  CheckoutMutationError,
  createCheckoutService,
} from '@/lib/services/orders/CheckoutService';
import {
  PaymentAttemptError,
  createPaymentAttemptService,
} from '@/lib/services/payments/PaymentAttemptService';

function nullableFormValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value : null;
}

function checkoutErrorRedirect(error: unknown): never {
  const message =
    error instanceof CheckoutMutationError ||
    error instanceof PaymentAttemptError ||
    error instanceof z.ZodError
      ? error instanceof z.ZodError
        ? 'Review the checkout details and try again.'
        : error.message
      : 'Checkout could not be completed safely. Please try again.';
  redirect(`/checkout?error=${encodeURIComponent(message)}`);
}

export async function createCheckoutOrderAction(formData: FormData) {
  if (getCommerceDataSource() !== 'firestore') {
    redirect(
      '/checkout?error=Order creation requires the Firestore commerce data source.',
    );
  }

  const cartId = z.string().min(1).max(128).parse(formData.get('cartId'));
  const identity = await getCheckoutIdentity(cartId);

  if (!identity) {
    redirect('/checkout?error=The checkout session could not be verified.');
  }

  const fulfilmentMethod = formData.get('fulfilment');
  const paymentMethod = formData.get('payment');
  const rawInput = {
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    company: nullableFormValue(formData, 'company'),
    customerNote: nullableFormValue(formData, 'customerNote'),
    fulfilmentMethod,
    deliveryAddress:
      fulfilmentMethod === 'delivery'
        ? {
            recipientName: formData.get('fullName'),
            phone: formData.get('phone'),
            line1: formData.get('addressLine1'),
            line2: nullableFormValue(formData, 'addressLine2'),
            landmark: nullableFormValue(formData, 'landmark'),
            city: formData.get('city'),
            state: 'Lagos',
            zoneId: formData.get('deliveryZoneId'),
          }
        : null,
    paymentMethod,
    expectedCartVersion: Number(formData.get('cartVersion')),
    idempotencyKey: formData.get('idempotencyKey'),
    termsAccepted: formData.get('termsAccepted') === 'on',
    privacyAccepted: formData.get('privacyAccepted') === 'on',
  };

  let creationResult;

  try {
    creationResult = await createCheckoutService().createOrder(identity, rawInput as never);
  } catch (error) {
    checkoutErrorRedirect(error);
  }

  if (creationResult.paymentAttempt) {
    try {
      const paymentRedirect = await createPaymentAttemptService().initialiseAttempt(
        creationResult.paymentAttempt.id,
        identity,
      );
      redirect(paymentRedirect.authorizationUrl);
    } catch (error) {
      if (error instanceof PaymentAttemptError) {
        redirect(
          `/orders/${creationResult.order.reference}/confirmation?payment=initialisation-failed`,
        );
      }
      throw error;
    }
  }

  redirect(`/orders/${creationResult.order.reference}/confirmation`);
}


export async function retryPaystackPaymentAction(formData: FormData) {
  const input = z
    .object({
      orderId: z.string().min(1).max(128),
      orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
      cartId: z.string().min(1).max(128),
      idempotencyKey: z
        .string()
        .min(16)
        .max(160)
        .regex(/^[A-Za-z0-9._:-]+$/),
    })
    .parse({
      orderId: formData.get('orderId'),
      orderReference: formData.get('orderReference'),
      cartId: formData.get('cartId'),
      idempotencyKey: formData.get('idempotencyKey'),
    });
  const identity = await getCheckoutIdentity(input.cartId);

  if (!identity) {
    redirect('/checkout?error=The payment retry session could not be verified.');
  }

  try {
    const service = createPaymentAttemptService();
    const retryAttempt = await service.createRetryAttempt(
      input.orderId,
      identity,
      input.idempotencyKey,
    );
    const paymentRedirect = await service.initialiseAttempt(
      retryAttempt.attempt.id,
      identity,
    );
    redirect(paymentRedirect.authorizationUrl);
  } catch (error) {
    if (error instanceof PaymentAttemptError) {
      redirect(
        `/orders/${input.orderReference}/confirmation?payment=retry-failed`,
      );
    }
    throw error;
  }
}
