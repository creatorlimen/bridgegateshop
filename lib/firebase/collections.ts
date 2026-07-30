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
  inventoryReservations: 'inventoryReservations',
  inventoryMovements: 'inventoryMovements',
  carts: 'carts',
  cartItems: 'items',
  userProfiles: 'userProfiles',
  staffMemberships: 'staffMemberships',
} as const;

export type FirestoreCollectionName =
  (typeof firestoreCollections)[keyof typeof firestoreCollections];
