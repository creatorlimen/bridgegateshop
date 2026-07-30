export type StockState = 'inStock' | 'lowStock' | 'outOfStock';

export type CatalogueSeo = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  imagePath?: string;
};

export type ProductCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  seo?: CatalogueSeo;
};

export type ProductVariant = {
  id: string;
  name: string;
  sku: string;
  packageLabel: string;
  priceKobo: number;
  compareAtPriceKobo?: number;
  stockState: StockState;
  coverageSquareMetres?: number;
};

export type ProductSpecification = {
  label: string;
  value: string;
};

export type ProductImage = {
  id: string;
  path: string;
  alt: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  shortDescription: string;
  description: string;
  imagePath: string;
  detailImagePath?: string;
  imageAlt: string;
  galleryImages?: ProductImage[];
  status: 'active' | 'outOfStock';
  badge?: string;
  featured: boolean;
  variants: ProductVariant[];
  specifications: ProductSpecification[];
  usageGuidance: string[];
  seo?: CatalogueSeo;
};
