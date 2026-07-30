import { ArrowUpRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { getStartingPriceKobo } from '@/lib/utils/catalogue/getStartingPriceKobo';
import type { Product } from '@/lib/types/catalogue';
import { formatMoney } from '@/lib/utils/money/formatMoney';

import { StockPill } from './StockPill';

export function ProductCard({ product }: { product: Product }) {
  const primaryVariant = product.variants[0];

  return (
    <article className="product-card group">
      <Link
        className="block overflow-hidden rounded-[1.75rem] bg-paper"
        href={`/products/${product.slug}`}
      >
        <div className="relative aspect-[1/1.08] overflow-hidden">
          <Image
            className="product-card-image object-cover"
            src={product.imagePath}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
            {product.badge ? (
              <span className="rounded-full bg-paper/90 px-3 py-1.5 text-[0.65rem] font-black uppercase tracking-[0.11em] backdrop-blur">
                {product.badge}
              </span>
            ) : (
              <span />
            )}
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-white transition group-hover:bg-amber group-hover:text-ink">
              <ArrowUpRight aria-hidden="true" size={17} />
            </span>
          </div>
        </div>
      </Link>
      <div className="px-1 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-black uppercase tracking-[0.13em] text-clay">
              {product.categoryName}
            </p>
            <h3 className="mt-2 text-lg font-black tracking-[-0.025em]">
              <Link
                className="rounded-sm hover:text-clay"
                href={`/products/${product.slug}`}
              >
                {product.name}
              </Link>
            </h3>
          </div>
          <StockPill stockState={primaryVariant.stockState} />
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">
          {product.shortDescription}
        </p>
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-ink/10 pt-4">
          <p>
            <span className="block text-[0.65rem] font-bold uppercase tracking-[0.09em] text-muted">
              From
            </span>
            <span className="mt-1 block text-lg font-black">
              {formatMoney(getStartingPriceKobo(product))}
            </span>
          </p>
          <span className="text-xs font-bold text-muted">
            {product.variants.length}{' '}
            {product.variants.length === 1 ? 'size' : 'sizes'}
          </span>
        </div>
      </div>
    </article>
  );
}
