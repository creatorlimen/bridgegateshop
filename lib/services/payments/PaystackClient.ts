import 'server-only';

import { z } from 'zod';

const paystackInitialisationResponseSchema = z
  .object({
    status: z.literal(true),
    message: z.string().max(500),
    data: z
      .object({
        authorization_url: z.string().url(),
        access_code: z.string().min(1).max(200),
        reference: z.string().min(8).max(100),
      })
      .passthrough(),
  })
  .passthrough();

const paystackVerificationResponseSchema = z
  .object({
    status: z.literal(true),
    message: z.string().max(500),
    data: z
      .object({
        id: z.union([z.number().int().nonnegative(), z.string().min(1).max(40)]),
        status: z.string().min(1).max(40),
        reference: z.string().min(8).max(100),
        amount: z.number().int().nonnegative(),
        currency: z.string().min(3).max(8),
        paid_at: z.string().datetime().nullable(),
        channel: z.string().min(1).max(80).nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const paystackRefundResponseSchema = z
  .object({
    status: z.literal(true),
    message: z.string().max(500),
    data: z
      .object({
        id: z.union([z.number().int().nonnegative(), z.string().min(1).max(120)]),
        amount: z.number().int().positive(),
        currency: z.string().min(3).max(8),
        status: z.string().min(1).max(80),
        expected_at: z.string().datetime().nullable().optional(),
        refunded_at: z.string().datetime().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type PaymentInitialisation = {
  email: string;
  amountKobo: number;
  currency: 'NGN';
  reference: string;
  callbackUrl: string;
  orderId: string;
  orderReference: string;
};

export type PaymentRedirect = {
  authorizationUrl: string;
  accessCode: string;
  providerReference: string;
  safeMessage: string;
};

export type VerifiedPayment = {
  providerTransactionId: string;
  providerReference: string;
  amountKobo: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  channel: string | null;
  safeMessage: string;
  safeResponseHashInput: string;
};

export interface PaymentProvider {
  initialiseTransaction(input: PaymentInitialisation): Promise<PaymentRedirect>;
  verifyTransaction(providerReference: string): Promise<VerifiedPayment>;
}

export type ProviderRefundInput = {
  transactionReference: string;
  amountKobo: number;
  currency: 'NGN';
  customerNote: string;
  merchantNote: string;
};

export type ProviderRefundResult = {
  providerRefundId: string;
  amountKobo: number;
  currency: string;
  status: string;
  expectedAt: Date | null;
  refundedAt: Date | null;
  safeMessage: string;
};

export interface RefundProvider {
  createRefund(input: ProviderRefundInput): Promise<ProviderRefundResult>;
}

export class PaystackProviderError extends Error {
  constructor(
    readonly code: 'CONFIGURATION' | 'UNAVAILABLE' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'PaystackProviderError';
  }
}

function getPaystackSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new PaystackProviderError(
      'CONFIGURATION',
      'Paystack server credentials are not configured.',
    );
  }

  return secretKey;
}

async function requestPaystack(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PaystackProviderError(
      'UNAVAILABLE',
      'Paystack could not be reached. Please try again.',
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new PaystackProviderError(
      'INVALID_RESPONSE',
      'Paystack returned an unreadable response.',
    );
  }

  if (!response.ok) {
    const safeMessage = z
      .object({ message: z.string().max(500) })
      .passthrough()
      .safeParse(payload);
    throw new PaystackProviderError(
      'UNAVAILABLE',
      safeMessage.success
        ? safeMessage.data.message
        : 'Paystack rejected the request. Please try again.',
    );
  }

  return payload;
}

export class PaystackClient implements PaymentProvider {
  async initialiseTransaction(
    input: PaymentInitialisation,
  ): Promise<PaymentRedirect> {
    const payload = await requestPaystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: String(input.amountKobo),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: JSON.stringify({
          order_id: input.orderId,
          order_reference: input.orderReference,
        }),
      }),
    });
    const parsedResponse = paystackInitialisationResponseSchema.safeParse(payload);

    if (!parsedResponse.success) {
      throw new PaystackProviderError(
        'INVALID_RESPONSE',
        'Paystack returned an invalid initialisation response.',
      );
    }

    const authorizationUrl = new URL(parsedResponse.data.data.authorization_url);

    if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'checkout.paystack.com') {
      throw new PaystackProviderError(
        'INVALID_RESPONSE',
        'Paystack returned an unexpected checkout destination.',
      );
    }

    if (parsedResponse.data.data.reference !== input.reference) {
      throw new PaystackProviderError(
        'INVALID_RESPONSE',
        'Paystack returned a mismatched payment reference.',
      );
    }

    return {
      authorizationUrl: authorizationUrl.toString(),
      accessCode: parsedResponse.data.data.access_code,
      providerReference: parsedResponse.data.data.reference,
      safeMessage: parsedResponse.data.message,
    };
  }

  async verifyTransaction(providerReference: string): Promise<VerifiedPayment> {
    const payload = await requestPaystack(
      `/transaction/verify/${encodeURIComponent(providerReference)}`,
      { method: 'GET' },
    );
    const parsedResponse = paystackVerificationResponseSchema.safeParse(payload);

    if (!parsedResponse.success) {
      throw new PaystackProviderError(
        'INVALID_RESPONSE',
        'Paystack returned an invalid verification response.',
      );
    }

    const transaction = parsedResponse.data.data;

    return {
      providerTransactionId: String(transaction.id),
      providerReference: transaction.reference,
      amountKobo: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      paidAt: transaction.paid_at ? new Date(transaction.paid_at) : null,
      channel: transaction.channel,
      safeMessage: parsedResponse.data.message,
      safeResponseHashInput: JSON.stringify({
        id: String(transaction.id),
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        paidAt: transaction.paid_at,
        channel: transaction.channel,
      }),
    };
  }

  async createRefund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    const payload = await requestPaystack('/refund', {
      method: 'POST',
      body: JSON.stringify({
        transaction: input.transactionReference,
        amount: input.amountKobo,
        currency: input.currency,
        customer_note: input.customerNote,
        merchant_note: input.merchantNote,
      }),
    });
    const parsed = paystackRefundResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new PaystackProviderError(
        'INVALID_RESPONSE',
        'Paystack returned an invalid refund response.',
      );
    }
    const refund = parsed.data.data;
    if (refund.amount !== input.amountKobo || refund.currency !== input.currency) {
      throw new PaystackProviderError(
        'INVALID_RESPONSE',
        'Paystack returned mismatched refund details.',
      );
    }
    return {
      providerRefundId: String(refund.id),
      amountKobo: refund.amount,
      currency: refund.currency,
      status: refund.status,
      expectedAt: refund.expected_at ? new Date(refund.expected_at) : null,
      refundedAt: refund.refunded_at ? new Date(refund.refunded_at) : null,
      safeMessage: parsed.data.message,
    };
  }
}

