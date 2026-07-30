import type { Metadata } from 'next';
import {
  ArrowLeft,
  Calculator,
  Check,
  MessageCircle,
  Package,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { addCartItemAction } from '@/app/actions/cart';
import { ProductCard } from '@/app/components/commerce/ProductCard';
import { StockPill } from '@/app/components/commerce/StockPill';
import {
  getProductBySlug,
  getStartingPriceKobo,
  products,
} from '@/lib/data/placeholder-catalogue';
import { formatMoney } from '@/lib/utils/money/formatMoney';

type ProductPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return products.map((product) => ({
    slug: product.slug,
  }));
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = getProductBySlug(slug);

  return {
    title: product?.name ?? 'Product',
    description: product?.shortDescription,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const relatedProducts = products
    .filter(
      (relatedProduct) =>
        relatedProduct.id !== product.id &&
        relatedProduct.categoryId === product.categoryId,
    )
    .slice(0, 3);

  return (
    <div className="shell py-8 sm:py-12">
      <Link
        className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-ink"
        href="/shop"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to shop
      </Link>

      <section className="mt-7 grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div className="relative min-h-[30rem] overflow-hidden rounded-[2rem] bg-paper sm:min-h-[39rem]">
          <Image
            className="object-cover"
            src={product.imagePath}
            alt={product.imageAlt}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 52vw"
          />
          <div className="absolute left-5 top-5 flex flex-wrap gap-2">
            {product.badge ? (
              <span className="rounded-full bg-paper/90 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.1em] backdrop-blur">
                {product.badge}
              </span>
            ) : null}
            <span className="rounded-full bg-clay px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.1em] text-white">
              Placeholder product
            </span>
          </div>
        </div>

        <div className="lg:py-5">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-clay">
            {product.categoryName}
          </p>
          <h1 className="display-type mt-4 text-balance text-5xl leading-[0.98] sm:text-6xl">
            {product.name}
          </h1>
          <p className="mt-5 text-base leading-7 text-muted">
            {product.shortDescription}
          </p>

          <div className="mt-7 flex items-end justify-between gap-6 border-y border-ink/10 py-5">
            <p>
              <span className="block text-[0.66rem] font-black uppercase tracking-[0.12em] text-muted">
                Starting from
              </span>
              <span className="mt-1 block text-3xl font-black tracking-[-0.04em]">
                {formatMoney(getStartingPriceKobo(product))}
              </span>
            </p>
            <p className="rounded-full bg-amber/20 px-3 py-2 text-xs font-bold">
              Preview price
            </p>
          </div>

          <form action={addCartItemAction} className="mt-7">
            <fieldset>
              <legend className="text-sm font-black">Choose a pack size</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {product.variants.map((variant, variantIndex) => (
                  <label
                    className="relative cursor-pointer rounded-2xl border border-ink/15 bg-paper p-4 has-[:checked]:border-ink has-[:checked]:ring-2 has-[:checked]:ring-amber"
                    key={variant.id}
                  >
                    <input
                      className="peer sr-only"
                      defaultChecked={variantIndex === 0}
                      name="variantId"
                      type="radio"
                      value={variant.id}
                    />
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block text-sm font-black">
                          {variant.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted">
                          {variant.packageLabel}
                        </span>
                      </span>
                      <StockPill stockState={variant.stockState} />
                    </span>
                    <span className="mt-4 block text-base font-black">
                      {formatMoney(variant.priceKobo)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-full border border-ink/15 bg-paper px-5 sm:w-32">
                <span className="text-xs font-bold text-muted">Qty</span>
                <input
                  className="w-12 bg-transparent text-center font-black outline-none"
                  defaultValue="1"
                  max="100"
                  min="1"
                  name="quantity"
                  type="number"
                />
              </label>
              <button className="button-primary min-h-14 flex-1" type="submit">
                Add to cart
                <Package aria-hidden="true" size={18} />
              </button>
            </div>
          </form>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-ink/15 bg-paper px-3 text-center text-xs font-black hover:border-ink"
              href="/calculator"
            >
              <Calculator aria-hidden="true" size={17} />
              Estimate quantity
            </Link>
            <a
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-ink/15 bg-paper px-3 text-center text-xs font-black hover:border-ink"
              href="https://wa.me/2348000000000?text=Hi%2C%20I%20need%20help%20with%20a%20BridgegateShop%20product."
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle aria-hidden="true" size={17} />
              Ask on WhatsApp
            </a>
          </div>

          <ul className="mt-7 grid gap-3 text-sm text-ink/70">
            <li className="flex items-center gap-3">
              <Truck aria-hidden="true" className="text-clay" size={18} />
              Lagos delivery zones and store pickup planned
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck aria-hidden="true" className="text-clay" size={18} />
              Price, stock, and eligibility revalidated on the server
            </li>
          </ul>
        </div>
      </section>

      <section className="mt-20 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.75rem] border border-ink/10 bg-paper p-7 sm:p-10">
          <p className="eyebrow text-clay">Product overview</p>
          <h2 className="display-type mt-5 text-4xl">Built for a clear decision.</h2>
          <p className="mt-5 text-sm leading-7 text-muted">
            {product.description}
          </p>
          <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 sm:grid-cols-2">
            {product.specifications.map((specification) => (
              <div
                className="bg-canvas p-5"
                key={`${specification.label}-${specification.value}`}
              >
                <dt className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-muted">
                  {specification.label}
                </dt>
                <dd className="mt-2 text-sm font-bold">{specification.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-[1.75rem] bg-ink p-7 text-white sm:p-10">
          <p className="eyebrow text-amber">Before application</p>
          <h2 className="display-type mt-5 text-4xl">Practical usage notes.</h2>
          <ol className="mt-8 grid gap-5">
            {product.usageGuidance.map((guidanceItem, guidanceIndex) => (
              <li className="flex gap-4" key={guidanceItem}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber text-xs font-black text-ink">
                  {guidanceIndex + 1}
                </span>
                <p className="pt-0.5 text-sm leading-6 text-white/65">
                  {guidanceItem}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-8 flex items-start gap-3 border-t border-white/12 pt-6 text-xs leading-5 text-white/45">
            <Check aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
            Replace these notes with the approved technical product sheet
            before public launch.
          </p>
        </div>
      </section>

      {relatedProducts.length > 0 ? (
        <section className="mt-24">
          <div className="flex items-end justify-between gap-5">
            <div>
              <p className="eyebrow text-clay">Related products</p>
              <h2 className="display-type mt-5 text-4xl sm:text-5xl">
                More from {product.categoryName}.
              </h2>
            </div>
            <Link className="text-sm font-black hover:text-clay" href="/shop">
              View shop
            </Link>
          </div>
          <div className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {relatedProducts.map((relatedProduct) => (
              <ProductCard product={relatedProduct} key={relatedProduct.id} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
