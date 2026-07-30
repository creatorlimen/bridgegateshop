'use client';

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth';

import { getFirebaseClientEnvironment } from '@/lib/config/clientEnvironment';

let firebaseClientApp: FirebaseApp | undefined;
let firebaseClientAuthPromise: Promise<Auth> | undefined;

function getFirebaseClientApp() {
  if (firebaseClientApp) {
    return firebaseClientApp;
  }

  const firebaseEnvironment = getFirebaseClientEnvironment();

  firebaseClientApp =
    getApps()[0] ??
    initializeApp({
      apiKey: firebaseEnvironment.apiKey,
      authDomain: firebaseEnvironment.authDomain,
      projectId: firebaseEnvironment.projectId,
      storageBucket: firebaseEnvironment.storageBucket,
      messagingSenderId: firebaseEnvironment.messagingSenderId,
      appId: firebaseEnvironment.appId,
    });

  return firebaseClientApp;
}

export function getFirebaseClientAuth() {
  if (firebaseClientAuthPromise) {
    return firebaseClientAuthPromise;
  }

  const firebaseAuth = getAuth(getFirebaseClientApp());
  const { useEmulators } = getFirebaseClientEnvironment();

  if (useEmulators) {
    connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
  }

  firebaseClientAuthPromise = setPersistence(
    firebaseAuth,
    inMemoryPersistence,
  ).then(() => firebaseAuth);

  return firebaseClientAuthPromise;
}
