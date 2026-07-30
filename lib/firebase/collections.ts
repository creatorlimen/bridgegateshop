export const firestoreCollections = {
  categories: 'categories',
  products: 'products',
  productVariants: 'productVariants',
  productMedia: 'productMedia',
  slugClaims: 'slugClaims',
  skuClaims: 'skuClaims',
  inventoryBalances: 'inventoryBalances',
  userProfiles: 'userProfiles',
  staffMemberships: 'staffMemberships',
} as const;

export type FirestoreCollectionName =
  (typeof firestoreCollections)[keyof typeof firestoreCollections];
