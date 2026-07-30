import type { Metadata } from 'next';
import {
  ArrowRight,
  PackageOpen,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import {
  acknowledgeCartPricesAction,
  removeCartItemAction,
  updateCartItemAction,
} from '@/app/actions/cart';
import { getCurrentCart } from '@/lib/services/carts/authoritativeCart';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cart',
  robots: {
    index: false,
    follow: false,
  },
};

type CartPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function CartPage({ searchParams }: CartPageProps) {
  const [cart, resolvedSearchParams] = await Promise.all([
    getCurrentCart(),
    searchParams,
  ]);

  if (cart.lines.length === 0) {
    return (
      <div className="shell py-16">
        <div className="mx-auto max-w-2xl rounded-[2rem] border border-ink/10 bg-paper p-9 text-center sm:p-14">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber/20 text-clay">
            <PackageOpen aria-hidden="true" size={29} />
          </span>
          <h1 className="display-type mt-7 text-5xl">
            Your cart is ready when you are.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted">
            Add a product to start a persistent cart. Current prices and
            availability are resolved by the server whenever the cart is
            opened or changed.
          </p>
          {resolvedSearchParams.error ? (
            <p
              className="mt-5 rounded-2xl bg-clay/10 p-4 text-sm font-bold text-clay"
              role="alert"
            >
              {resolvedSearchParams.error}
            </p>
          ) : null}
          <Link className="button-primary mt-8" href="/shop">
            Browse materials
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="shell py-12 sm:py-16">
      <div>
        <p className="eyebrow text-clay">Your cart</p>
        <h1 className="display-type mt-5 text-5xl sm:text-6xl">
          Review the material list.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
          The cart stores identifiers, requested quantities, and the last
          displayed price. Current price and stock remain
          server-authoritative.
        </p>
      </div>

      {resolvedSearchParams.error ? (
        <div
          className="mt-8 rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm"
          role="alert"
        >
          <p className="font-black">{resolvedSearchParams.error}</p>
        </div>
      ) : null}

      {cart.issues.length > 0 || cart.mergeNotices.length > 0 ? (
        <div
          className="mt-8 rounded-2xl border border-amber/30 bg-amber/15 p-5 text-sm"
          role="status"
        >
          <p className="font-black">Your cart needs review.</p>
          <ul className="mt-3 grid gap-2 text-ink/70">
            {cart.issues.map((issue) => (
              <li key={`${issue.variantId}-${issue.code}`}>
                {issue.message}
              </li>
            ))}
            {cart.mergeNotices.map((notice) => (
              <li key={`${notice.variantId}-${notice.code}`}>
                {notice.code === 'UNAVAILABLE'
                  ? 'An unavailable guest-cart item was not merged.'
                  : `A merged quantity was adjusted from ${notice.requestedQuantity} to ${notice.acceptedQuantity}.`}
              </li>
            ))}
          </ul>
          {cart.issues.some(
            (issue) => issue.code === 'PRICE_CHANGED',
          ) ? (
            <form action={acknowledgeCartPricesAction} className="mt-4">
              <button
                className="rounded-full bg-ink px-4 py-2 text-xs font-black text-white"
                type="submit"
              >
                Accept current prices
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_23rem]">
        <div className="grid gap-4">
          {cart.lines.map((cartLine) => {
            const productHref = cartLine.productSlug
              ? `/products/${cartLine.productSlug}`
              : '/shop';

            return (
              <article
                className="grid gap-5 rounded-[1.75rem] border border-ink/10 bg-paper p-4 sm:grid-cols-[9rem_1fr] sm:p-5"
                key={cartLine.variantId}
              >
                <Link
                  className="relative aspect-square overflow-hidden rounded-2xl bg-canvas"
                  href={productHref}
                >
                  <Image
                    alt={cartLine.imageAlt}
                    className="object-cover"
                    fill
                    sizes="144px"
                    src={cartLine.imagePath}
                  />
                </Link>
                <div className="flex min-w-0 flex-col justify-between gap-5">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-clay">
                        {cartLine.packageLabel}
                      </p>
                      <h2 className="mt-2 text-lg font-black">
                        <Link
                          className="hover:text-clay"
                          href={productHref}
                        >
                          {cartLine.productName}
                        </Link>
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        {cartLine.variantName}
                      </p>
                      {cartLine.issues.length > 0 ? (
                        <p className="mt-2 text-xs font-bold text-clay">
                          {cartLine.issues
                            .map((issue) =>
                              issue
                                .replaceAll('_', ' ')
                                .toLowerCase(),
                            )
                            .join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-black">
                        {formatMoney(cartLine.lineTotalKobo)}
                      </p>
                      {cartLine.issues.includes('PRICE_CHANGED') ? (
                        <p className="mt-1 text-xs text-muted">
                          Previously{' '}
                          {formatMoney(
                            cartLine.previousUnitPriceKobo *
                              cartLine.requestedQuantity,
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                    <form
                      action={updateCartItemAction}
                      className="flex items-center gap-2"
                    >
                      <input
                        name="variantId"
                        type="hidden"
                        value={cartLine.variantId}
                      />
                      <label
                        className="text-xs font-bold text-muted"
                        htmlFor={`quantity-${cartLine.variantId}`}
                      >
                        Quantity
                      </label>
                      <input
                        className="h-10 w-16 rounded-full border border-ink/15 bg-canvas px-2 text-center text-sm font-black"
                        defaultValue={cartLine.requestedQuantity}
                        id={`quantity-${cartLine.variantId}`}
                        max="100"
                        min="1"
                        name="quantity"
                        type="number"
                      />
                      <button
                        className="h-10 rounded-full border border-ink/15 px-4 text-xs font-black hover:border-ink"
                        type="submit"
                      >
                        Update
                      </button>
                    </form>
                    <form action={removeCartItemAction}>
                      <input
                        name="variantId"
                        type="hidden"
                        value={cartLine.variantId}
                      />
                      <button
                        className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-black text-clay hover:bg-clay/5"
                        type="submit"
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="h-fit rounded-[1.75rem] bg-ink p-6 text-white sm:p-7 lg:sticky lg:top-28">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-amber">
            Order summary
          </p>
          <dl className="mt-6 grid gap-4 text-sm">
            <div className="flex justify-between gap-4 text-white/60">
              <dt>Subtotal</dt>
              <dd className="font-bold text-white">
                {formatMoney(cart.subtotalKobo)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-white/60">
              <dt>Delivery</dt>
              <dd className="font-bold text-white">Calculated next</dd>
            </div>
          </dl>
          <div className="mt-6 flex items-end justify-between gap-4 border-t border-white/15 pt-6">
            <p className="text-sm text-white/60">Current subtotal</p>
            <p className="text-2xl font-black">
              {formatMoney(cart.subtotalKobo)}
            </p>
          </div>
          {cart.readyForCheckout ? (
            <Link
              className="button-primary mt-6 w-full"
              href="/checkout"
            >
              Continue to checkout
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          ) : (
            <p className="mt-6 rounded-2xl bg-white/10 p-4 text-center text-xs font-black text-white/65">
              Resolve the highlighted cart changes to continue.
            </p>
          )}
          <p className="mt-5 flex items-start gap-2 text-[0.7rem] leading-5 text-white/48">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={14}
            />
            Checkout revalidates catalogue state, current price, managed
            stock, delivery eligibility, and totals before order creation.
          </p>
        </aside>
      </div>
    </div>
  );
}
