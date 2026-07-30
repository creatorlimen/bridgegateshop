import 'server-only';

import { cookies } from 'next/headers';

import { getServerEnvironment } from '@/lib/config/serverEnvironment';
import { getFirebaseAdminAuth } from '@/lib/firebase/admin';

export type AuthenticatedSession = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
};

type GetSessionOptions = {
  checkRevoked?: boolean;
};

export async function getCurrentSession({
  checkRevoked = false,
}: GetSessionOptions = {}): Promise<AuthenticatedSession | null> {
  let serverEnvironment;

  try {
    serverEnvironment = getServerEnvironment();
  } catch {
    return null;
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(
    serverEnvironment.sessionCookieName,
  )?.value;

  if (!sessionCookie) {
    return null;
  }

  try {
    const decodedSession = await getFirebaseAdminAuth().verifySessionCookie(
      sessionCookie,
      checkRevoked,
    );

    return {
      uid: decodedSession.uid,
      email: decodedSession.email ?? null,
      emailVerified: decodedSession.email_verified ?? false,
      phoneNumber: decodedSession.phone_number ?? null,
      issuedAtSeconds: decodedSession.iat,
      expiresAtSeconds: decodedSession.exp,
    };
  } catch {
    return null;
  }
}
