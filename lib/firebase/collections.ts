export const firestoreCollections = {
  categories: 'categories',
  products: 'products',
  productVariants: 'productVariants',
  productMedia: 'productMedia',
  slugClaims: 'slugClaims',
  skuClaims: 'skuClaims',
  slugRedirects: 'slugRedirects',
  searchDocuments: 'searchDocuments',
  uploadIntents: 'uploadIntents',
  auditEvents: 'auditEvents',
  outboxEvents: 'outboxEvents',
  inventoryBalances: 'inventoryBalances',
  userProfiles: 'userProfiles',
  staffMemberships: 'staffMemberships',
} as const;

export type FirestoreCollectionName =
  (typeof firestoreCollections)[keyof typeof firestoreCollections];
