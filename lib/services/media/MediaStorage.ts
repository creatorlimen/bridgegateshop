import 'server-only';

export type MediaObjectMetadata = {
  bytes: number;
  contentType: string | null;
};

export interface MediaStorage {
  createWriteUrl(input: {
    storageObjectPath: string;
    contentType: string;
    expiresAt: Date;
  }): Promise<string>;
  getObjectMetadata(
    storageObjectPath: string,
  ): Promise<MediaObjectMetadata>;
  downloadObject(storageObjectPath: string): Promise<Buffer>;
  copyObject(
    sourceStorageObjectPath: string,
    destinationStorageObjectPath: string,
  ): Promise<void>;
  saveObject(input: {
    storageObjectPath: string;
    content: Buffer;
    contentType: string;
    cacheControl: string;
  }): Promise<void>;
  deleteObject(storageObjectPath: string): Promise<void>;
}
