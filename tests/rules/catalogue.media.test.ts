import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getFirebaseAdminFirestore,
  getFirebaseAdminStorage,
} from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { productMediaDocumentSchema } from '@/lib/schemas/catalogue';
import { CatalogueMediaService } from '@/lib/services/catalogue/CatalogueMediaService';
import type { CatalogueMutationActor } from '@/lib/services/catalogue/CatalogueMutationService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const ownerActor: CatalogueMutationActor = {
  actorId: 'stage4-media-owner',
  roleIds: ['owner'],
  requestId: 'request-stage4-media-owner',
};
let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

beforeEach(async () => {
  await Promise.all([
    testEnvironment.clearFirestore(),
    testEnvironment.clearStorage(),
  ]);
  await seedCatalogue(getFirebaseAdminFirestore());
});

afterAll(async () => {
  await Promise.all([
    testEnvironment.clearFirestore(),
    testEnvironment.clearStorage(),
  ]);
  await testEnvironment.cleanup();
});

describe('catalogue media finalisation', () => {
  it('validates a quarantined image and creates responsive derivatives', async () => {
    const firestore = getFirebaseAdminFirestore();
    const bucket = getFirebaseAdminStorage().bucket();
    const uploadIntentId = 'upload-intent-media-test';
    const stagingStorageObjectPath =
      'quarantine/catalogue/product-signature-pop/media-test.png';
    const imageBuffer = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 4,
        background: '#d2c6b0ff',
      },
    })
      .png()
      .toBuffer();
    const now = Timestamp.now();

    await bucket.file(stagingStorageObjectPath).save(imageBuffer, {
      resumable: false,
      metadata: {
        contentType: 'image/png',
      },
    });
    await firestore
      .collection(firestoreCollections.uploadIntents)
      .doc(uploadIntentId)
      .set({
        schemaVersion: 1,
        purpose: 'catalogueProductMedia',
        productId: 'product-signature-pop',
        ownerUid: ownerActor.actorId,
        originalFileName: 'media-test.png',
        declaredMimeType: 'image/png',
        declaredBytes: imageBuffer.byteLength,
        altText: 'Signature POP Paint warm neutral bucket',
        stagingStorageObjectPath,
        status: 'pending',
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000),
        finalisedAt: null,
        mediaId: null,
        safeFailureCode: null,
      });

    const result = await new CatalogueMediaService().finaliseUpload(
      { uploadIntentId },
      ownerActor,
    );
    const mediaSnapshot = await firestore
      .collection(firestoreCollections.productMedia)
      .doc(result.mediaId)
      .get();
    const parsedMedia = productMediaDocumentSchema.parse(
      mediaSnapshot.data(),
    );
    const cardDerivative = parsedMedia.derivatives.find(
      (derivative) => derivative.kind === 'card',
    );
    const [cardExists] = await bucket
      .file(cardDerivative?.storageObjectPath ?? 'missing')
      .exists();

    expect(result.replayed).toBe(false);
    expect(parsedMedia.processingState).toBe('ready');
    expect(parsedMedia.derivatives.map((derivative) => derivative.kind)).toEqual(
      ['thumbnail', 'card', 'detail', 'social'],
    );
    expect(cardExists).toBe(true);
  });
});
