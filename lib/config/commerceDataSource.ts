import 'server-only';

import {
  getCatalogueDataSource,
  type CatalogueDataSource,
} from '@/lib/config/catalogueDataSource';

export type CommerceDataSource = CatalogueDataSource;

export function getCommerceDataSource(): CommerceDataSource {
  return getCatalogueDataSource();
}
