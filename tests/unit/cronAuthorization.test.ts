import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isCronRequestAuthorized } from '@/lib/security/cronAuthorization';

const previousCronSecret = process.env.CRON_SECRET;
const previousCronAuthSecret = process.env.CRON_AUTH_SECRET;

afterEach(() => {
  if (previousCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = previousCronSecret;
  }

  if (previousCronAuthSecret === undefined) {
    delete process.env.CRON_AUTH_SECRET;
  } else {
    process.env.CRON_AUTH_SECRET = previousCronAuthSecret;
  }
});

describe('scheduled-job authorization', () => {
  it('accepts the exact Vercel bearer secret', () => {
    process.env.CRON_SECRET = 'stage5-vercel-secret';

    expect(
      isCronRequestAuthorized(
        new Request('https://example.test/api/cron/reservations', {
          headers: {
            authorization: 'Bearer stage5-vercel-secret',
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects missing, malformed, and incorrect credentials', () => {
    process.env.CRON_SECRET = 'stage5-vercel-secret';

    expect(
      isCronRequestAuthorized(
        new Request('https://example.test/api/cron/reservations'),
      ),
    ).toBe(false);
    expect(
      isCronRequestAuthorized(
        new Request('https://example.test/api/cron/reservations', {
          headers: {
            authorization: 'Basic stage5-vercel-secret',
          },
        }),
      ),
    ).toBe(false);
    expect(
      isCronRequestAuthorized(
        new Request('https://example.test/api/cron/reservations', {
          headers: {
            authorization: 'Bearer stage5-wrong-secret',
          },
        }),
      ),
    ).toBe(false);
  });

  it('supports the non-Vercel scheduler alias', () => {
    delete process.env.CRON_SECRET;
    process.env.CRON_AUTH_SECRET = 'stage5-external-secret';

    expect(
      isCronRequestAuthorized(
        new Request('https://example.test/api/cron/reservations', {
          headers: {
            authorization: 'Bearer stage5-external-secret',
          },
        }),
      ),
    ).toBe(true);
  });
});
