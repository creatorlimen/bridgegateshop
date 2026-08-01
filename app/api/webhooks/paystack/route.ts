import { NextResponse } from 'next/server';

import { loadCheckoutSettings } from '@/lib/config/checkoutSettings';
import {
  PaystackWebhookError,
  createPaystackWebhookService,
} from '@/lib/services/payments/PaystackWebhookService';
import { verifyPaystackWebhookSignature } from '@/lib/services/payments/paystackWebhookSignature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhookSecret =
    process.env.PAYSTACK_WEBHOOK_SECRET?.trim() ||
    process.env.PAYSTACK_SECRET_KEY?.trim() ||
    '';
  const signature = request.headers.get('x-paystack-signature');

  if (!verifyPaystackWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json(
      { accepted: false, error: 'Invalid webhook signature.' },
      { status: 401 },
    );
  }

  try {
    const settings = await loadCheckoutSettings();
    const result = await createPaystackWebhookService(undefined, undefined, settings).processSignedEvent(rawBody);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof PaystackWebhookError && error.code === 'INVALID_PAYLOAD') {
      return NextResponse.json(
        { accepted: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { accepted: false, error: 'Webhook processing is temporarily unavailable.' },
      { status: 503 },
    );
  }
}

