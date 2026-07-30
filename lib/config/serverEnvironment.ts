import 'server-only';

import { z } from 'zod';

const serverEnvironmentSchema = z.object({
  appBaseUrl: z.string().url(),
  appEnvironment: z.enum(['development', 'test', 'staging', 'production']),
  sessionCookieName: z.string().min(1).max(80),
  sessionMaxAgeSeconds: z.number().int().min(300).max(1209600),
  firebaseProjectId: z.string().min(1),
  firebaseClientEmail: z.string().email(),
  firebasePrivateKey: z.string().min(1),
  firebaseStorageBucket: z.string().min(1),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

let cachedServerEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedServerEnvironment) {
    return cachedServerEnvironment;
  }

  const usesFirebaseEmulators = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_STORAGE_EMULATOR_HOST,
  );
  const parsedEnvironment = serverEnvironmentSchema.safeParse({
    appBaseUrl: process.env.APP_BASE_URL,
    appEnvironment: process.env.APP_ENV ?? 'development',
    sessionCookieName:
      process.env.SESSION_COOKIE_NAME ?? 'bridgegate_session',
    sessionMaxAgeSeconds: Number(
      process.env.SESSION_MAX_AGE_SECONDS ?? 432000,
    ),
    firebaseProjectId:
      process.env.FIREBASE_PROJECT_ID ??
      (usesFirebaseEmulators ? 'demo-bridgegate-shop' : undefined),
    firebaseClientEmail:
      process.env.FIREBASE_CLIENT_EMAIL ??
      (usesFirebaseEmulators
        ? 'firebase-emulator@bridgegate.invalid'
        : undefined),
    firebasePrivateKey:
      process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') ??
      (usesFirebaseEmulators
        ? 'emulator-credential-not-used'
        : undefined),
    firebaseStorageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ??
      (usesFirebaseEmulators
        ? 'demo-bridgegate-shop.appspot.com'
        : undefined),
  });

  if (!parsedEnvironment.success) {
    const invalidFields = parsedEnvironment.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');

    throw new Error(
      `Server environment configuration is incomplete: ${invalidFields}`,
    );
  }

  cachedServerEnvironment = parsedEnvironment.data;
  return cachedServerEnvironment;
}
