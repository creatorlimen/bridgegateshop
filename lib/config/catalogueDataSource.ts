import 'server-only';

import { z } from 'zod';

const catalogueDataSourceSchema = z
  .enum(['auto', 'placeholder', 'firestore'])
  .default('auto');

export type CatalogueDataSource = 'placeholder' | 'firestore';

function hasFirebaseAdminConfiguration() {
  const usesFirebaseEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST,
  );

  return (
    usesFirebaseEmulator ||
    Boolean(
      process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY &&
        process.env.FIREBASE_STORAGE_BUCKET,
    )
  );
}

export function getCatalogueDataSource(): CatalogueDataSource {
  const configuredDataSource = catalogueDataSourceSchema.parse(
    process.env.CATALOGUE_DATA_SOURCE,
  );

  if (configuredDataSource === 'placeholder') {
    return 'placeholder';
  }

  if (configuredDataSource === 'firestore') {
    if (!hasFirebaseAdminConfiguration()) {
      throw new Error(
        'CATALOGUE_DATA_SOURCE is firestore, but Firebase Admin configuration is incomplete.',
      );
    }

    return 'firestore';
  }

  return hasFirebaseAdminConfiguration() ? 'firestore' : 'placeholder';
}
