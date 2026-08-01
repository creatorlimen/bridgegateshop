import { createHash } from 'node:crypto';

export function createDeterministicId(prefix: string, value: string) {
  return `${prefix}_${createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 48)}`;
}

export function getInitialPaymentAttemptId(orderId: string) {
  return createDeterministicId('attempt', `${orderId}:paystack:full:1`);
}

export function getPaystackReference(attemptId: string) {
  return `BGSPS${createHash('sha256')
    .update(attemptId)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase()}`;
}

