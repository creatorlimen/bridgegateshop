import 'server-only';

import { timingSafeEqual } from 'node:crypto';

function safelyCompareSecrets(
  providedSecret: string,
  expectedSecret: string,
) {
  const providedBuffer = Buffer.from(providedSecret, 'utf8');
  const expectedBuffer = Buffer.from(expectedSecret, 'utf8');

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function isCronRequestAuthorized(request: Request) {
  const expectedSecret =
    process.env.CRON_SECRET?.trim() ||
    process.env.CRON_AUTH_SECRET?.trim();
  const authorizationHeader = request.headers.get('authorization');
  const bearerPrefix = 'Bearer ';

  if (
    !expectedSecret ||
    !authorizationHeader?.startsWith(bearerPrefix)
  ) {
    return false;
  }

  return safelyCompareSecrets(
    authorizationHeader.slice(bearerPrefix.length),
    expectedSecret,
  );
}
