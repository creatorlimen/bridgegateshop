import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaystackWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature) || !secret) {
    return false;
  }

  const expectedSignature = createHmac('sha512', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  const suppliedBuffer = Buffer.from(signature.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

