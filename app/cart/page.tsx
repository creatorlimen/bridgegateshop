import type { Metadata } from 'next';
import { ArrowRight, PackageOpen, ShieldCheck, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import {
  removeCartItemAction,
  updateCartItemAction,
} from '@/app/actions/cart';
import { getPreviewCartLines } from '@/lib/services/carts/previewCart';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cart',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CartPage() {
  const cartLines = await getPreviewCartLines();
  const subtotalKobo = cartLines.reduce(
    (runningTotal, cartLine) => runningTotal + cartLine.lineTotalKobo,
    0,
  );

  if (cartLines.length === 0) {
    return (
      <div className="shell py-16">
        <div className="mx-auto max-w-2xl rounded-[2rem] border border-ink/10 bg-paper p-9 text-center sm:p-14">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber/20 text-clay">
            <PackageOpen aria-hidden="true" size={29} />
          </span>
          <h1 className="display-type mt-7 text-5xl">Your cart is ready when you are.</h1>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted">
            Add a product to start a server-revalidated preview cart. Prices
            and availability will be checked again before real order creation.
          </p>
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
          This preview cart stores product IDs and quantities only. Display
          prices are resolved again from the server catalogue.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_23rem]">
        <div className="grid gap-4">
          {cartLines.map((cartLine) => (
            <article
              className="grid gap-5 rounded-[1.75rem] border border-ink/10 bg-paper p-4 sm:grid-cols-[9rem_1fr] sm:p-5"
              key={cartLine.variantId}
            >
              <Link
                className="relative aspect-square overflow-hidden rounded-2xl bg-canvas"
                href={`/products/${cartLine.productSlug}`}
              >
                <Image
                  className="object-cover"
                  src={cartLine.imagePath}
                  alt={cartLine.imageAlt}
                  fill
                  sizes="144px"
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
                        href={`/products/${cartLine.productSlug}`}
                      >
                        {cartLine.productName}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      {cartLine.variantName}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-black">
                    {formatMoney(cartLine.lineTotalKobo)}
                  </p>
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
                      defaultValue={cartLine.quantity}
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
          ))}
        </div>

        <aside className="h-fit rounded-[1.75rem] bg-ink p-6 text-white sm:p-7 lg:sticky lg:top-28">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-amber">
            Order summary
          </p>
          <dl className="mt-6 grid gap-4 text-sm">
            <div className="flex justify-between gap-4 text-white/60">
              <dt>Subtotal</dt>
              <dd className="font-bold text-white">
                {formatMoney(subtotalKobo)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-white/60">
              <dt>Delivery</dt>
              <dd className="font-bold text-white">Calculated next</dd>
            </div>
          </dl>
          <div className="mt-6 flex items-end justify-between gap-4 border-t border-white/15 pt-6">
            <p className="text-sm text-white/60">Current subtotal</p>
            <p className="text-2xl font-black">{formatMoney(subtotalKobo)}</p>
          </div>
          <Link
            className="button-primary mt-6 w-full"
            href="/checkout"
          >
            Continue to checkout
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
          <p className="mt-5 flex items-start gap-2 text-[0.7rem] leading-5 text-white/48">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={14}
            />
            Checkout will revalidate product, stock, delivery, eligibility, and
            totals before creating an order.
          </p>
        </aside>
      </div>
    </div>
  );
}
