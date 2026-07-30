import { NextResponse } from 'next/server';

import {
  createCsrfToken,
  csrfCookieName,
  hashCsrfToken,
} from '@/lib/security/csrf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 5;

export async function GET() {
  const csrfToken = createCsrfToken();
  const response = NextResponse.json(
    { csrfToken },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );

  response.cookies.set(csrfCookieName, hashCsrfToken(csrfToken), {
    httpOnly: true,
    maxAge: 10 * 60,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
