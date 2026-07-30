import type { Product, ProductCategory } from '@/lib/types/catalogue';

export const productCategories: ProductCategory[] = [
  {
    id: 'category-pop-paint',
    name: 'POP Paint',
    slug: 'pop-paint',
    description:
      'Interior finishing paints selected for smooth POP ceilings, walls, and decorative details.',
  },
  {
    id: 'category-white-bond',
    name: 'White Bond',
    slug: 'white-bond',
    description:
      'Reliable bonding compounds for tile, screed, and finishing applications.',
  },
];

export const products: Product[] = [
  {
    id: 'product-signature-pop',
    slug: 'signature-pop-paint',
    name: 'Signature POP Paint',
    categoryId: 'category-pop-paint',
    categoryName: 'POP Paint',
    shortDescription:
      'A smooth, low-sheen finish designed for crisp ceilings and refined interior details.',
    description:
      'Signature POP Paint is a placeholder launch product for the BridgegateShop prototype. Final formulation, claims, coverage, colours, and technical specifications require Specta approval before publication.',
    imagePath: '/images/pop-paint-placeholder.png',
    imageAlt:
      'Unbranded placeholder paint bucket on a pale stone display plinth',
    status: 'active',
    badge: 'Project favourite',
    featured: true,
    variants: [
      {
        id: 'variant-signature-pop-4l',
        name: '4 litres',
        sku: 'PLACEHOLDER-POP-4L',
        packageLabel: '4 L bucket',
        priceKobo: 1250000,
        stockState: 'inStock',
        coverageSquareMetres: 24,
      },
      {
        id: 'variant-signature-pop-20l',
        name: '20 litres',
        sku: 'PLACEHOLDER-POP-20L',
        packageLabel: '20 L bucket',
        priceKobo: 4250000,
        compareAtPriceKobo: 4600000,
        stockState: 'lowStock',
        coverageSquareMetres: 120,
      },
    ],
    specifications: [
      { label: 'Finish', value: 'Low sheen — placeholder' },
      { label: 'Application', value: 'Interior POP surfaces' },
      { label: 'Dry time', value: 'Pending approval' },
      { label: 'Coverage', value: 'Variant-specific estimate' },
    ],
    usageGuidance: [
      'Prepare a clean, dry, dust-free surface.',
      'Confirm the approved primer and coat system before use.',
      'Use the material calculator as an estimate, not a substitute for site assessment.',
    ],
  },
  {
    id: 'product-pro-pop',
    slug: 'pro-cover-pop-paint',
    name: 'Pro Cover POP Paint',
    categoryId: 'category-pop-paint',
    categoryName: 'POP Paint',
    shortDescription:
      'Trade-focused coverage for larger ceiling and interior finishing work.',
    description:
      'Pro Cover POP Paint is placeholder catalogue content. Product performance statements and instructions must be replaced with approved Specta data before launch.',
    imagePath: '/images/pop-paint-placeholder.png',
    imageAlt:
      'Unbranded placeholder paint bucket photographed against a warm neutral backdrop',
    status: 'active',
    featured: true,
    variants: [
      {
        id: 'variant-pro-pop-20l',
        name: '20 litres',
        sku: 'PLACEHOLDER-PROPOP-20L',
        packageLabel: '20 L bucket',
        priceKobo: 3850000,
        stockState: 'inStock',
        coverageSquareMetres: 110,
      },
    ],
    specifications: [
      { label: 'Finish', value: 'Matt — placeholder' },
      { label: 'Application', value: 'Interior POP surfaces' },
      { label: 'Pack size', value: '20 litres' },
      { label: 'Coverage', value: 'Pending field approval' },
    ],
    usageGuidance: [
      'Review the surface condition before estimating materials.',
      'Mix and apply only according to the approved product sheet.',
    ],
  },
  {
    id: 'product-white-bond-standard',
    slug: 'white-bond-standard',
    name: 'White Bond Standard',
    categoryId: 'category-white-bond',
    categoryName: 'White Bond',
    shortDescription:
      'A practical bonding compound for everyday interior finishing applications.',
    description:
      'White Bond Standard is placeholder catalogue content. Suitability, mixing ratios, cure times, and application claims require approval before publication.',
    imagePath: '/images/white-bond-placeholder.png',
    imageAlt:
      'Unbranded placeholder construction compound bag beside a notched trowel',
    status: 'active',
    badge: 'Trade essential',
    featured: true,
    variants: [
      {
        id: 'variant-white-bond-standard-20kg',
        name: '20 kilograms',
        sku: 'PLACEHOLDER-WB-20KG',
        packageLabel: '20 kg bag',
        priceKobo: 1850000,
        stockState: 'inStock',
        coverageSquareMetres: 10,
      },
    ],
    specifications: [
      { label: 'Type', value: 'Bonding compound — placeholder' },
      { label: 'Application', value: 'Interior finishing' },
      { label: 'Pack size', value: '20 kilograms' },
      { label: 'Coverage', value: 'Pending field approval' },
    ],
    usageGuidance: [
      'Keep the sealed bag dry and raised off the floor.',
      'Confirm the approved water ratio and substrate preparation.',
    ],
  },
  {
    id: 'product-white-bond-pro',
    slug: 'white-bond-pro',
    name: 'White Bond Pro',
    categoryId: 'category-white-bond',
    categoryName: 'White Bond',
    shortDescription:
      'A project-grade placeholder option for demanding bonding and finishing work.',
    description:
      'White Bond Pro is placeholder catalogue content for interface testing. Final technical data, claims, and approvals are not yet available.',
    imagePath: '/images/white-bond-placeholder.png',
    imageAlt:
      'Unbranded placeholder construction material bag on a pale stone surface',
    status: 'active',
    featured: true,
    variants: [
      {
        id: 'variant-white-bond-pro-20kg',
        name: '20 kilograms',
        sku: 'PLACEHOLDER-WBPRO-20KG',
        packageLabel: '20 kg bag',
        priceKobo: 2250000,
        stockState: 'lowStock',
        coverageSquareMetres: 12,
      },
    ],
    specifications: [
      { label: 'Type', value: 'Bonding compound — placeholder' },
      { label: 'Application', value: 'Project finishing' },
      { label: 'Pack size', value: '20 kilograms' },
      { label: 'Coverage', value: 'Pending field approval' },
    ],
    usageGuidance: [
      'Use only on approved substrates.',
      'Follow the final technical product sheet when supplied.',
    ],
  },
];

export function getProductBySlug(productSlug: string) {
  return products.find((product) => product.slug === productSlug);
}

export function getCategoryBySlug(categorySlug: string) {
  return productCategories.find((category) => category.slug === categorySlug);
}

export function getStartingPriceKobo(product: Product) {
  return Math.min(...product.variants.map((variant) => variant.priceKobo));
}
