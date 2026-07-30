import 'server-only';

import { z } from 'zod';

import { getCatalogueDataSource } from '@/lib/config/catalogueDataSource';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { catalogueSlugSchema } from '@/lib/schemas/catalogue';
import { firestoreDocumentIdSchema } from '@/lib/schemas/common';

const catalogueRedirectDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    ownerType: z.enum(['category', 'product']),
    ownerId: firestoreDocumentIdSchema,
    sourceSlug: catalogueSlugSchema,
    targetSlug: catalogueSlugSchema,
  })
  .passthrough();

export async function resolveCatalogueRedirect(
  ownerType: 'category' | 'product',
  sourceSlug: string,
) {
  if (getCatalogueDataSource() !== 'firestore') {
    return null;
  }

  const parsedSourceSlug = catalogueSlugSchema.safeParse(sourceSlug);

  if (!parsedSourceSlug.success) {
    return null;
  }

  const redirectSnapshot = await getFirebaseAdminFirestore()
    .collection(firestoreCollections.slugRedirects)
    .doc(`${ownerType}:${parsedSourceSlug.data}`)
    .get();
  const parsedRedirect = catalogueRedirectDocumentSchema.safeParse(
    redirectSnapshot.data(),
  );

  return redirectSnapshot.exists &&
    parsedRedirect.success &&
    parsedRedirect.data.ownerType === ownerType &&
    parsedRedirect.data.sourceSlug === parsedSourceSlug.data
    ? parsedRedirect.data.targetSlug
    : null;
}
