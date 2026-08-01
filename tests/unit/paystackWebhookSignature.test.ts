import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyPaystackWebhookSignature } from '@/lib/services/payments/paystackWebhookSignature';

describe('Paystack webhook signature verification', () => {
  it('accepts the exact HMAC SHA-512 signature over the raw body', () => {
    const body = '{"event":"charge.success","data":{"reference":"BGSPS12345678"}}';
    const secret = 'stage6-paystack-test-secret';
    const signature = createHmac('sha512', secret).update(body).digest('hex');

    expect(verifyPaystackWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyPaystackWebhookSignature(`${body} `, signature, secret)).toBe(false);
  });

  it('rejects missing and malformed signatures without throwing', () => {
    expect(verifyPaystackWebhookSignature('{}', null, 'secret')).toBe(false);
    expect(verifyPaystackWebhookSignature('{}', 'not-a-hash', 'secret')).toBe(false);
  });
});

