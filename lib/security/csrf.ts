import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const csrfCookieName = 'bridgegate_csrf';

export function createCsrfToken() {
  return randomBytes(32).toString('base64url');
}

export function hashCsrfToken(csrfToken: string) {
  return createHash('sha256').update(csrfToken).digest('hex');
}

export function csrfTokenMatches(
  submittedToken: string | null,
  storedTokenHash: string | undefined,
) {
  if (!submittedToken || !storedTokenHash) {
    return false;
  }

  const submittedTokenHash = hashCsrfToken(submittedToken);
  const submittedBuffer = Buffer.from(submittedTokenHash, 'hex');
  const storedBuffer = Buffer.from(storedTokenHash, 'hex');

  return (
    submittedBuffer.length === storedBuffer.length &&
    timingSafeEqual(submittedBuffer, storedBuffer)
  );
}
