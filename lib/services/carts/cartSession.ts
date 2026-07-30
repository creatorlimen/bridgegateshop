import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import { getCurrentSession } from '@/lib/auth/session';
import {
  createCartService,
  type CartIdentity,
} from '@/lib/services/carts/CartService';

export const authoritativeCartCookieName = 'bridgegate_cart';
const authoritativeCartCookieLifetimeSeconds = 30 * 24 * 60 * 60;
const cartCookieSchema = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{43})$/;

function hashGuestToken(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function parseAuthoritativeCartCookie(
  cookieValue: string | undefined,
): {
  cartId: string;
  rawToken: string;
  guestTokenHash: string;
} | null {
  const match = cookieValue ? cartCookieSchema.exec(cookieValue) : null;

  return match
    ? {
        cartId: match[1],
        rawToken: match[2],
        guestTokenHash: hashGuestToken(match[2]),
      }
    : null;
}

export async function mergeGuestCartForOwner(
  cookieValue: string | undefined,
  ownerUid: string,
) {
  const parsedCookie = parseAuthoritativeCartCookie(cookieValue);

  if (!parsedCookie) {
    return { merged: false };
  }

  const cartService = createCartService();
  const guestIdentity = await cartService.verifyGuestCart(
    parsedCookie.cartId,
    parsedCookie.guestTokenHash,
  );

  if (!guestIdentity) {
    return { merged: false };
  }

  const mergeResult = await cartService.mergeGuestCart(
    guestIdentity,
    ownerUid,
  );

  return {
    merged: true,
    cartId: mergeResult.identity.cartId,
    notices: mergeResult.notices,
  };
}

export async function getCartIdentity({
  createIfMissing,
}: {
  createIfMissing: boolean;
}): Promise<CartIdentity | null> {
  const [session, cookieStore] = await Promise.all([
    getCurrentSession(),
    cookies(),
  ]);
  const cartService = createCartService();

  if (session) {
    return createIfMissing
      ? cartService.getOrCreateCustomerCart(session.uid)
      : cartService.findActiveCustomerCart(session.uid);
  }

  const cartCookie = parseAuthoritativeCartCookie(
    cookieStore.get(authoritativeCartCookieName)?.value,
  );

  if (cartCookie) {
    const verifiedIdentity = await cartService.verifyGuestCart(
      cartCookie.cartId,
      cartCookie.guestTokenHash,
    );

    if (verifiedIdentity) {
      return verifiedIdentity;
    }
  }

  if (!createIfMissing) {
    return null;
  }

  const rawToken = randomBytes(32).toString('base64url');
  const guestTokenHash = hashGuestToken(rawToken);
  const identity = await cartService.createGuestCart(guestTokenHash);

  cookieStore.set(
    authoritativeCartCookieName,
    `${identity.cartId}.${rawToken}`,
    {
      httpOnly: true,
      maxAge: authoritativeCartCookieLifetimeSeconds,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  );

  return identity;
}
