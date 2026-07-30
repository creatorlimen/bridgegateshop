import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  catalogueSearchDocumentSchema,
  type CatalogueSearchRecord,
} from '@/lib/schemas/catalogueSearch';
import {
  scoreCatalogueSearchResult,
  tokeniseSearchText,
} from '@/lib/utils/catalogue/searchTokens';

const searchQuerySchema = z.string().trim().min(2).max(120);
const searchLimitSchema = z.number().int().min(1).max(50);

export interface CatalogueSearchRepository {
  searchActiveProducts(
    query: string,
    limit?: number,
  ): Promise<CatalogueSearchRecord[]>;
}

class FirestoreCatalogueSearchRepository
  implements CatalogueSearchRepository
{
  constructor(private readonly firestore: Firestore) {}

  async searchActiveProducts(query: string, limit = 24) {
    const parsedQuery = searchQuerySchema.parse(query);
    const parsedLimit = searchLimitSchema.parse(limit);
    const queryTokens = tokeniseSearchText(parsedQuery);
    const primaryQueryToken = queryTokens[0];

    if (!primaryQueryToken) {
      return [];
    }

    const searchSnapshot = await this.firestore
      .collection(firestoreCollections.searchDocuments)
      .where('searchTokens', 'array-contains', primaryQueryToken)
      .limit(100)
      .get();

    return searchSnapshot.docs
      .map((searchDocument) => {
        const parsedDocument = catalogueSearchDocumentSchema.safeParse(
          searchDocument.data(),
        );

        if (!parsedDocument.success) {
          return null;
        }

        return {
          id: searchDocument.id,
          ...parsedDocument.data,
        };
      })
      .filter(
        (searchRecord): searchRecord is CatalogueSearchRecord =>
          searchRecord !== null &&
          queryTokens.every((queryToken) =>
            searchRecord.searchTokens.includes(queryToken),
          ),
      )
      .map((searchRecord) => ({
        searchRecord,
        score: scoreCatalogueSearchResult(parsedQuery, searchRecord),
      }))
      .filter((scoredRecord) => scoredRecord.score > 0)
      .sort(
        (leftRecord, rightRecord) =>
          rightRecord.score - leftRecord.score ||
          leftRecord.searchRecord.title.localeCompare(
            rightRecord.searchRecord.title,
            'en-NG',
          ),
      )
      .slice(0, parsedLimit)
      .map(({ searchRecord }) => searchRecord);
  }
}

export function createCatalogueSearchRepository(
  firestore: Firestore = getFirebaseAdminFirestore(),
): CatalogueSearchRepository {
  return new FirestoreCatalogueSearchRepository(firestore);
}
