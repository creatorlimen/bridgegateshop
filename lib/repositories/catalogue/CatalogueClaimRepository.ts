import 'server-only';

import {
  FieldValue,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { firestoreCollections } from '@/lib/firebase/collections';
import {
  catalogueSlugSchema,
  normalisedSkuSchema,
} from '@/lib/schemas/catalogue';
import {
  catalogueSkuClaimDocumentSchema,
  catalogueSlugClaimDocumentSchema,
} from '@/lib/schemas/catalogueClaims';
import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
} from '@/lib/schemas/common';

export type CatalogueSlugOwnerType = 'category' | 'product';

type ReserveSlugClaimInput = {
  ownerType: CatalogueSlugOwnerType;
  ownerId: string;
  slug: string;
  actorId: string;
};

type ReserveSkuClaimInput = {
  variantId: string;
  sku: string;
  actorId: string;
};

type ReleaseSlugClaimInput = {
  ownerType: CatalogueSlugOwnerType;
  ownerId: string;
  slug: string;
};

export class CatalogueClaimConflictError extends Error {
  readonly claimType: 'slug' | 'sku';
  readonly claimKey: string;

  constructor(claimType: 'slug' | 'sku', claimKey: string) {
    super(`The catalogue ${claimType} claim "${claimKey}" is unavailable.`);
    this.name = 'CatalogueClaimConflictError';
    this.claimType = claimType;
    this.claimKey = claimKey;
  }
}

export class CatalogueClaimDataError extends Error {
  constructor(claimPath: string, options?: ErrorOptions) {
    super(`Catalogue claim ${claimPath} is invalid.`, options);
    this.name = 'CatalogueClaimDataError';
  }
}

function parseOwnerId(ownerId: string) {
  return firestoreDocumentIdSchema.parse(ownerId);
}

function parseActorId(actorId: string) {
  return actorReferenceSchema.parse(actorId);
}

function normaliseSku(sku: string) {
  return normalisedSkuSchema.parse(sku.trim().toUpperCase());
}

export function getSlugClaimDocumentId(
  ownerType: CatalogueSlugOwnerType,
  slug: string,
) {
  return `${ownerType}:${catalogueSlugSchema.parse(slug)}`;
}

export async function reserveSlugClaim(
  transaction: Transaction,
  firestore: Firestore,
  input: ReserveSlugClaimInput,
) {
  const ownerId = parseOwnerId(input.ownerId);
  const actorId = parseActorId(input.actorId);
  const claimDocumentId = getSlugClaimDocumentId(
    input.ownerType,
    input.slug,
  );
  const claimReference = firestore
    .collection(firestoreCollections.slugClaims)
    .doc(claimDocumentId);
  const claimSnapshot = await transaction.get(claimReference);

  if (claimSnapshot.exists) {
    const parsedClaim = catalogueSlugClaimDocumentSchema.safeParse(
      claimSnapshot.data(),
    );

    if (!parsedClaim.success) {
      throw new CatalogueClaimDataError(claimReference.path, {
        cause: parsedClaim.error,
      });
    }

    if (
      parsedClaim.data.ownerId !== ownerId ||
      parsedClaim.data.ownerType !== input.ownerType
    ) {
      throw new CatalogueClaimConflictError('slug', claimDocumentId);
    }

    return;
  }

  transaction.create(claimReference, {
    schemaVersion: 1,
    ownerType: input.ownerType,
    ownerId,
    claimedAt: FieldValue.serverTimestamp(),
    claimedBy: actorId,
  });
}

export async function reserveSkuClaim(
  transaction: Transaction,
  firestore: Firestore,
  input: ReserveSkuClaimInput,
) {
  const variantId = parseOwnerId(input.variantId);
  const actorId = parseActorId(input.actorId);
  const skuNormalised = normaliseSku(input.sku);
  const claimReference = firestore
    .collection(firestoreCollections.skuClaims)
    .doc(skuNormalised);
  const claimSnapshot = await transaction.get(claimReference);

  if (claimSnapshot.exists) {
    const parsedClaim = catalogueSkuClaimDocumentSchema.safeParse(
      claimSnapshot.data(),
    );

    if (!parsedClaim.success) {
      throw new CatalogueClaimDataError(claimReference.path, {
        cause: parsedClaim.error,
      });
    }

    if (parsedClaim.data.ownerId !== variantId) {
      throw new CatalogueClaimConflictError('sku', skuNormalised);
    }

    return;
  }

  transaction.create(claimReference, {
    schemaVersion: 1,
    ownerId: variantId,
    claimedAt: FieldValue.serverTimestamp(),
    claimedBy: actorId,
  });
}

export async function releaseSlugClaim(
  transaction: Transaction,
  firestore: Firestore,
  input: ReleaseSlugClaimInput,
) {
  const ownerId = parseOwnerId(input.ownerId);
  const claimDocumentId = getSlugClaimDocumentId(
    input.ownerType,
    input.slug,
  );
  const claimReference = firestore
    .collection(firestoreCollections.slugClaims)
    .doc(claimDocumentId);
  const claimSnapshot = await transaction.get(claimReference);

  if (!claimSnapshot.exists) {
    return;
  }

  const parsedClaim = catalogueSlugClaimDocumentSchema.safeParse(
    claimSnapshot.data(),
  );

  if (!parsedClaim.success) {
    throw new CatalogueClaimDataError(claimReference.path, {
      cause: parsedClaim.error,
    });
  }

  if (
    parsedClaim.data.ownerId !== ownerId ||
    parsedClaim.data.ownerType !== input.ownerType
  ) {
    throw new CatalogueClaimConflictError('slug', claimDocumentId);
  }

  transaction.delete(claimReference);
}
