import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { getServerEnvironment } from '@/lib/config/serverEnvironment';

function initialiseFirebaseAdminApp(): App {
  const existingApp = getApps()[0];

  if (existingApp) {
    return existingApp;
  }

  if (
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ) {
    return initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID ?? 'demo-bridgegate-shop',
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET ??
        'demo-bridgegate-shop.appspot.com',
    });
  }

  const serverEnvironment = getServerEnvironment();

  return initializeApp({
    credential: cert({
      projectId: serverEnvironment.firebaseProjectId,
      clientEmail: serverEnvironment.firebaseClientEmail,
      privateKey: serverEnvironment.firebasePrivateKey,
    }),
    projectId: serverEnvironment.firebaseProjectId,
    storageBucket: serverEnvironment.firebaseStorageBucket,
  });
}

export function getFirebaseAdminApp() {
  return initialiseFirebaseAdminApp();
}

export function getFirebaseAdminAuth(): Auth {
  return getAuth(initialiseFirebaseAdminApp());
}

export function getFirebaseAdminFirestore(): Firestore {
  return getFirestore(initialiseFirebaseAdminApp());
}

export function getFirebaseAdminStorage(): Storage {
  return getStorage(initialiseFirebaseAdminApp());
}
