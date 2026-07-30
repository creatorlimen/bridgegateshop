import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const projectId = 'demo-bridgegate-shop';
let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  const [firestoreRules, storageRules] = await Promise.all([
    readFile(path.join(process.cwd(), 'firestore.rules'), 'utf8'),
    readFile(path.join(process.cwd(), 'storage.rules'), 'utf8'),
  ]);

  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: firestoreRules,
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: storageRules,
    },
  });
});

afterEach(async () => {
  await Promise.all([
    testEnvironment.clearFirestore(),
    testEnvironment.clearStorage(),
  ]);
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('default-deny Firebase rules', () => {
  it('rejects an anonymous direct Firestore read', async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(firestore, 'products/demo-product')));
  });

  it('rejects an authenticated direct Firestore write', async () => {
    const firestore = testEnvironment
      .authenticatedContext('customer-1', { email: 'customer@example.com' })
      .firestore();

    await assertFails(
      setDoc(doc(firestore, 'users/customer-1'), {
        displayName: 'Attempted browser write',
      }),
    );
  });

  it('rejects an authenticated direct Storage upload', async () => {
    const storage = testEnvironment
      .authenticatedContext('staff-1', { email: 'staff@example.com' })
      .storage();

    await assertFails(
      uploadString(ref(storage, 'product-images/untrusted.txt'), 'blocked'),
    );
  });
});
