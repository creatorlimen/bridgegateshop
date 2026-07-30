import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import sharp, { type Metadata } from 'sharp';

import type { CatalogueMutationActor } from '@/lib/services/catalogue/CatalogueMutationService';
import { CatalogueMutationError } from '@/lib/services/catalogue/CatalogueMutationService';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { createFirebaseMediaStorage } from '@/lib/services/media/FirebaseMediaStorage';
import type { MediaStorage } from '@/lib/services/media/MediaStorage';
import {
  productDocumentSchema,
  productMediaDocumentSchema,
} from '@/lib/schemas/catalogue';
import {
  catalogueUploadIntentDocumentSchema,
  type CreateCatalogueUploadIntentInput,
  type FinaliseCatalogueUploadInput,
} from '@/lib/schemas/mediaUpload';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';

const uploadIntentLifetimeMilliseconds = 15 * 60 * 1_000;
const maximumImagePixels = 40_000_000;

const imageFormatMimeTypes = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

const derivativeDefinitions = [
  {
    kind: 'thumbnail' as const,
    width: 320,
    height: 320,
    fit: 'cover' as const,
  },
  {
    kind: 'card' as const,
    width: 800,
    height: 800,
    fit: 'cover' as const,
  },
  {
    kind: 'detail' as const,
    width: 1_600,
    height: 1_600,
    fit: 'inside' as const,
  },
  {
    kind: 'social' as const,
    width: 1_200,
    height: 630,
    fit: 'cover' as const,
  },
];

function parseStoredDocument<DocumentType>(
  snapshot: DocumentSnapshot,
  schema: { safeParse: (value: unknown) => {
    success: boolean;
    data?: DocumentType;
  } },
  entityLabel: string,
): DocumentType & { id: string } {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success || !parsedDocument.data) {
    throw new CatalogueMutationError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? `${entityLabel} contains invalid stored data.`
        : `${entityLabel} was not found.`,
    );
  }

  return {
    id: snapshot.id,
    ...parsedDocument.data,
  };
}

function getFileExtension(mimeType: string) {
  return mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType.slice('image/'.length);
}


async function validateImage(
  imageBuffer: Buffer,
  declaredMimeType: string,
) {
  let metadata: Metadata;

  try {
    metadata = await sharp(imageBuffer, {
      failOn: 'error',
      limitInputPixels: maximumImagePixels,
    }).metadata();
  } catch {
    throw new CatalogueMutationError(
      'VALIDATION_FAILED',
      'The uploaded file is not a valid supported image.',
      'file',
    );
  }

  const detectedMimeType =
    metadata.format &&
    imageFormatMimeTypes[
      metadata.format as keyof typeof imageFormatMimeTypes
    ];

  if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
    throw new CatalogueMutationError(
      'VALIDATION_FAILED',
      'The image signature does not match its declared file type.',
      'file',
    );
  }

  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 320 ||
    metadata.height < 320 ||
    metadata.width * metadata.height > maximumImagePixels ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new CatalogueMutationError(
      'VALIDATION_FAILED',
      'Product images must be a single frame, at least 320×320, and no larger than 40 megapixels.',
      'file',
    );
  }

  return {
    width: metadata.width,
    height: metadata.height,
  };
}

export class CatalogueMediaService {
  constructor(
    private readonly firestore: Firestore = getFirebaseAdminFirestore(),
    private readonly mediaStorage: MediaStorage = createFirebaseMediaStorage(),
  ) {}

  async createUploadIntent(
    input: CreateCatalogueUploadIntentInput,
    actor: CatalogueMutationActor,
  ) {
    const uploadIntentReference = this.firestore
      .collection(firestoreCollections.uploadIntents)
      .doc();
    const productReference = this.firestore
      .collection(firestoreCollections.products)
      .doc(input.productId);
    const extension = getFileExtension(input.mimeType);
    const stagingStorageObjectPath =
      `quarantine/catalogue/${input.productId}/` +
      `${uploadIntentReference.id}-${randomUUID()}.${extension}`;
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + uploadIntentLifetimeMilliseconds,
    );

    await this.firestore.runTransaction(async (transaction) => {
      const productSnapshot = await transaction.get(productReference);
      const product = parseStoredDocument(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );

      if (product.status === 'archived') {
        throw new CatalogueMutationError(
          'INVALID_STATE',
          'Media cannot be uploaded to an archived product.',
        );
      }

      transaction.create(uploadIntentReference, {
        schemaVersion: 1,
        purpose: 'catalogueProductMedia',
        productId: input.productId,
        ownerUid: actor.actorId,
        originalFileName: input.fileName,
        declaredMimeType: input.mimeType,
        declaredBytes: input.bytes,
        altText: input.altText,
        stagingStorageObjectPath,
        status: 'pending',
        createdAt: now,
        expiresAt,
        finalisedAt: null,
        mediaId: null,
        safeFailureCode: null,
      });
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.media.uploadIntent.create',
        entityType: 'uploadIntent',
        entityId: uploadIntentReference.id,
        changedFields: ['status'],
      });
    });

    try {
      const uploadUrl = await this.mediaStorage.createWriteUrl({
        storageObjectPath: stagingStorageObjectPath,
        contentType: input.mimeType,
        expiresAt: expiresAt.toDate(),
      });

      return {
        uploadIntentId: uploadIntentReference.id,
        uploadUrl,
        expiresAt: expiresAt.toDate().toISOString(),
        requiredHeaders: {
          'Content-Type': input.mimeType,
        },
      };
    } catch {
      await uploadIntentReference.update({
        status: 'failed',
        safeFailureCode: 'SIGNED_UPLOAD_UNAVAILABLE',
      });

      throw new CatalogueMutationError(
        'PROVIDER_UNAVAILABLE',
        'Secure image upload is temporarily unavailable.',
        undefined,
      );
    }
  }

  async finaliseUpload(
    input: FinaliseCatalogueUploadInput,
    actor: CatalogueMutationActor,
  ) {
    const uploadIntentReference = this.firestore
      .collection(firestoreCollections.uploadIntents)
      .doc(input.uploadIntentId);
    const initialIntentSnapshot = await uploadIntentReference.get();
    const initialIntent = parseStoredDocument(
      initialIntentSnapshot,
      catalogueUploadIntentDocumentSchema,
      'Upload intent',
    );

    if (initialIntent.ownerUid !== actor.actorId) {
      throw new CatalogueMutationError(
        'PERMISSION_DENIED',
        'This upload intent belongs to another staff session.',
      );
    }

    if (initialIntent.status === 'finalised' && initialIntent.mediaId) {
      return {
        mediaId: initialIntent.mediaId,
        replayed: true,
      };
    }

    if (initialIntent.status !== 'pending') {
      throw new CatalogueMutationError(
        'INVALID_STATE',
        'This upload intent cannot be finalised.',
      );
    }

    if (
      firestoreTimestampToDate(initialIntent.expiresAt).getTime() <
      Date.now()
    ) {
      throw new CatalogueMutationError(
        'INVALID_STATE',
        'This upload intent expired. Start a new upload.',
      );
    }

    const storageMetadata = await this.mediaStorage.getObjectMetadata(
      initialIntent.stagingStorageObjectPath,
    );
    const storedBytes = Number(storageMetadata.bytes);

    if (
      storageMetadata.contentType !== initialIntent.declaredMimeType ||
      !Number.isSafeInteger(storedBytes) ||
      storedBytes < 1 ||
      storedBytes > initialIntent.declaredBytes ||
      storedBytes > 8 * 1024 * 1024
    ) {
      throw new CatalogueMutationError(
        'VALIDATION_FAILED',
        'The uploaded image does not match its approved upload intent.',
        'file',
      );
    }

    const imageBuffer = await this.mediaStorage.downloadObject(initialIntent.stagingStorageObjectPath);
    const dimensions = await validateImage(
      imageBuffer,
      initialIntent.declaredMimeType,
    );
    const mediaReference = this.firestore
      .collection(firestoreCollections.productMedia)
      .doc();
    const mediaRootPath =
      `product-media/${initialIntent.productId}/${mediaReference.id}`;
    const sourceStorageObjectPath =
      `${mediaRootPath}/source.${getFileExtension(initialIntent.declaredMimeType)}`;
    const derivatives = [];

    await this.mediaStorage.copyObject(
      initialIntent.stagingStorageObjectPath,
      sourceStorageObjectPath,
    );

    for (const definition of derivativeDefinitions) {
      const derivativeBuffer = await sharp(imageBuffer, {
        failOn: 'error',
        limitInputPixels: maximumImagePixels,
      })
        .rotate()
        .resize({
          width: definition.width,
          height: definition.height,
          fit: definition.fit,
          withoutEnlargement: definition.fit === 'inside',
        })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      const derivativeStorageObjectPath =
        `${mediaRootPath}/${definition.kind}.webp`;

      await this.mediaStorage.saveObject({
        storageObjectPath: derivativeStorageObjectPath,
        content: derivativeBuffer,
        contentType: 'image/webp',
        cacheControl: 'public,max-age=31536000,immutable',
      });

      const derivativeMetadata = await sharp(
        derivativeBuffer,
      ).metadata();

      derivatives.push({
        kind: definition.kind,
        storageObjectPath: derivativeStorageObjectPath,
        width: derivativeMetadata.width,
        height: derivativeMetadata.height,
        bytes: derivativeBuffer.byteLength,
        mimeType: 'image/webp' as const,
      });
    }

    const now = Timestamp.now();
    const mediaDocument = productMediaDocumentSchema.parse({
      schemaVersion: 1,
      createdAt: now,
      createdBy: actor.actorId,
      updatedAt: now,
      updatedBy: actor.actorId,
      version: 1,
      productId: initialIntent.productId,
      sourceStorageObjectPath,
      derivatives,
      mimeType: initialIntent.declaredMimeType,
      width: dimensions.width,
      height: dimensions.height,
      bytes: imageBuffer.byteLength,
      altText: initialIntent.altText,
      sortOrder: 10,
      processingState: 'ready',
      uploadedBy: actor.actorId,
    });

    await this.firestore.runTransaction(async (transaction) => {
      const [intentSnapshot, productSnapshot, mediaSnapshot] =
        await transaction.getAll(
          uploadIntentReference,
          this.firestore
            .collection(firestoreCollections.products)
            .doc(initialIntent.productId),
          mediaReference,
        );
      const currentIntent = parseStoredDocument(
        intentSnapshot,
        catalogueUploadIntentDocumentSchema,
        'Upload intent',
      );
      const product = parseStoredDocument(
        productSnapshot,
        productDocumentSchema,
        'Product',
      );

      if (currentIntent.status === 'finalised' && currentIntent.mediaId) {
        return;
      }

      if (
        currentIntent.status !== 'pending' ||
        currentIntent.ownerUid !== actor.actorId ||
        product.status === 'archived' ||
        mediaSnapshot.exists
      ) {
        throw new CatalogueMutationError(
          'CONFLICT',
          'The upload state changed before it could be finalised.',
        );
      }

      transaction.create(mediaReference, mediaDocument);
      transaction.update(uploadIntentReference, {
        status: 'finalised',
        finalisedAt: now,
        mediaId: mediaReference.id,
        safeFailureCode: null,
      });
      writeAuditEvent(transaction, this.firestore, {
        ...actor,
        actorRoleIds: actor.roleIds,
        action: 'catalogue.media.finalise',
        entityType: 'productMedia',
        entityId: mediaReference.id,
        changedFields: ['processingState', 'derivatives'],
      });
    });

    await this.mediaStorage
      .deleteObject(initialIntent.stagingStorageObjectPath)
      .catch(() => {
      console.warn({
        eventName: 'catalogue.media.quarantineCleanup.failed',
        uploadIntentId: input.uploadIntentId,
      });
    });

    return {
      mediaId: mediaReference.id,
      replayed: false,
    };
  }
}
