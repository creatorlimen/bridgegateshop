import 'server-only';

import type { Bucket } from '@google-cloud/storage';

import { getFirebaseAdminStorage } from '@/lib/firebase/admin';
import type {
  MediaObjectMetadata,
  MediaStorage,
} from '@/lib/services/media/MediaStorage';

class FirebaseMediaStorage implements MediaStorage {
  constructor(
    private readonly bucket: Bucket = getFirebaseAdminStorage().bucket(),
  ) {}

  async createWriteUrl(input: {
    storageObjectPath: string;
    contentType: string;
    expiresAt: Date;
  }) {
    const [uploadUrl] = await this.bucket
      .file(input.storageObjectPath)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: input.expiresAt,
        contentType: input.contentType,
      });

    return uploadUrl;
  }

  async getObjectMetadata(
    storageObjectPath: string,
  ): Promise<MediaObjectMetadata> {
    const [metadata] = await this.bucket
      .file(storageObjectPath)
      .getMetadata();

    return {
      bytes: Number(metadata.size),
      contentType: metadata.contentType ?? null,
    };
  }

  async downloadObject(storageObjectPath: string) {
    const [content] = await this.bucket
      .file(storageObjectPath)
      .download();
    return content;
  }

  async copyObject(
    sourceStorageObjectPath: string,
    destinationStorageObjectPath: string,
  ) {
    await this.bucket
      .file(sourceStorageObjectPath)
      .copy(this.bucket.file(destinationStorageObjectPath));
  }

  async saveObject(input: {
    storageObjectPath: string;
    content: Buffer;
    contentType: string;
    cacheControl: string;
  }) {
    await this.bucket.file(input.storageObjectPath).save(input.content, {
      resumable: false,
      metadata: {
        contentType: input.contentType,
        cacheControl: input.cacheControl,
      },
    });
  }

  async deleteObject(storageObjectPath: string) {
    await this.bucket
      .file(storageObjectPath)
      .delete({ ignoreNotFound: true });
  }
}

export function createFirebaseMediaStorage(bucket?: Bucket): MediaStorage {
  return new FirebaseMediaStorage(bucket);
}
