import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCommerceDataSource } from '@/lib/config/commerceDataSource';
import { getServerEnvironment } from '@/lib/config/serverEnvironment';
import { getFirebaseAdminAuth } from '@/lib/firebase/admin';
import { csrfCookieName, csrfTokenMatches } from '@/lib/security/csrf';
import { requestHasTrustedOrigin } from '@/lib/security/requestOrigin';
import {
  authoritativeCartCookieName,
  mergeGuestCartForOwner,
} from '@/lib/services/carts/cartSession';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

const sessionRequestSchema = z.object({
  idToken: z.string().min(100).max(10000),
});

function createErrorResponse(
  status: number,
  code: string,
  message: string,
) {
  return NextResponse.json(
    { ok: false, code, message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

function getRequestCookie(request: Request, cookieName: string) {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((cookiePart) => cookiePart.trim())
    .find((cookiePart) => cookiePart.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

function requestHasValidCsrfToken(request: Request) {
  return csrfTokenMatches(
    request.headers.get('x-csrf-token'),
    getRequestCookie(request, csrfCookieName),
  );
}

export async function POST(request: Request) {
  let serverEnvironment;

  try {
    serverEnvironment = getServerEnvironment();
  } catch {
    return createErrorResponse(
      503,
      'AUTH_NOT_CONFIGURED',
      'Authentication is not configured for this environment.',
    );
  }

  if (!requestHasTrustedOrigin(request, serverEnvironment.appBaseUrl)) {
    return createErrorResponse(403, 'UNTRUSTED_ORIGIN', 'Request rejected.');
  }

  if (!requestHasValidCsrfToken(request)) {
    return createErrorResponse(403, 'INVALID_CSRF', 'Request rejected.');
  }

  let untrustedRequestBody: unknown;

  try {
    untrustedRequestBody = await request.json();
  } catch {
    return createErrorResponse(
      400,
      'VALIDATION_FAILED',
      'The session request is invalid.',
    );
  }

  const parsedRequest = sessionRequestSchema.safeParse(
    untrustedRequestBody,
  );

  if (!parsedRequest.success) {
    return createErrorResponse(
      400,
      'VALIDATION_FAILED',
      'The session request is invalid.',
    );
  }

  try {
    const firebaseAdminAuth = getFirebaseAdminAuth();
    const decodedIdToken = await firebaseAdminAuth.verifyIdToken(
      parsedRequest.data.idToken,
      true,
    );
    const currentTimeSeconds = Math.floor(Date.now() / 1000);

    if (
      !decodedIdToken.auth_time ||
      currentTimeSeconds - decodedIdToken.auth_time > 5 * 60
    ) {
      return createErrorResponse(
        401,
        'RECENT_AUTH_REQUIRED',
        'Please sign in again to continue.',
      );
    }

    let guestCartMerged = false;

    if (getCommerceDataSource() === 'firestore') {
      try {
        const mergeResult = await mergeGuestCartForOwner(
          getRequestCookie(request, authoritativeCartCookieName),
          decodedIdToken.uid,
        );
        guestCartMerged = mergeResult.merged;
      } catch {
        return createErrorResponse(
          409,
          'CART_MERGE_FAILED',
          'Your cart could not be merged safely. Please retry sign-in.',
        );
      }
    }

    const sessionCookie = await firebaseAdminAuth.createSessionCookie(
      parsedRequest.data.idToken,
      {
        expiresIn: serverEnvironment.sessionMaxAgeSeconds * 1000,
      },
    );
    const response = NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );

    response.cookies.set(
      serverEnvironment.sessionCookieName,
      sessionCookie,
      {
        httpOnly: true,
        maxAge: serverEnvironment.sessionMaxAgeSeconds,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    );

    if (guestCartMerged) {
      response.cookies.set(authoritativeCartCookieName, '', {
        expires: new Date(0),
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }

    response.cookies.set(csrfCookieName, '', {
      expires: new Date(0),
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch {
    console.warn({
      eventName: 'auth.session.create.failed',
      result: 'denied',
      safeErrorCode: 'INVALID_ID_TOKEN',
    });

    return createErrorResponse(
      401,
      'INVALID_CREDENTIALS',
      'Unable to sign in with those credentials.',
    );
  }
}

export async function DELETE(request: Request) {
  let serverEnvironment;

  try {
    serverEnvironment = getServerEnvironment();
  } catch {
    return createErrorResponse(
      503,
      'AUTH_NOT_CONFIGURED',
      'Authentication is not configured for this environment.',
    );
  }

  if (!requestHasTrustedOrigin(request, serverEnvironment.appBaseUrl)) {
    return createErrorResponse(403, 'UNTRUSTED_ORIGIN', 'Request rejected.');
  }

  if (!requestHasValidCsrfToken(request)) {
    return createErrorResponse(403, 'INVALID_CSRF', 'Request rejected.');
  }

  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );

  response.cookies.set(serverEnvironment.sessionCookieName, '', {
    expires: new Date(0),
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  response.cookies.set(csrfCookieName, '', {
    expires: new Date(0),
    httpOnly: true,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
