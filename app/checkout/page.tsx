import type { Metadata } from 'next';
import { LockKeyhole, MapPin, PackageCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { getPreviewCartLines } from '@/lib/services/carts/previewCart';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout preview',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CheckoutPage() {
  const cartLines = await getPreviewCartLines();
  const subtotalKobo = cartLines.reduce(
    (runningTotal, cartLine) => runningTotal + cartLine.lineTotalKobo,
    0,
  );

  if (cartLines.length === 0) {
    return (
      <div className="shell py-16 text-center">
        <h1 className="display-type text-5xl">Your checkout is empty.</h1>
        <Link className="button-primary mt-7" href="/shop">
          Return to shop
        </Link>
      </div>
    );
  }

  return (
    <div className="shell py-10 sm:py-14">
      <div className="mb-8 flex flex-col gap-4 border-b border-ink/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-clay">Checkout preview</p>
          <h1 className="display-type mt-5 text-5xl sm:text-6xl">
            Delivery and payment.
          </h1>
        </div>
        <p className="flex items-center gap-2 text-xs font-bold text-muted">
          <LockKeyhole aria-hidden="true" size={15} />
          No live order or payment will be created
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_23rem]">
        <div className="grid gap-5">
          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber/20 text-clay">
                <MapPin aria-hidden="true" size={19} />
              </span>
              <div>
                <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-muted">
                  Step 1
                </p>
                <h2 className="font-black">Contact and fulfilment</h2>
              </div>
            </div>

            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">
                Full name
                <input
                  className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal outline-none focus:border-ink"
                  name="fullName"
                  placeholder="Your full name"
                  type="text"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Nigerian phone number
                <input
                  className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal outline-none focus:border-ink"
                  name="phone"
                  placeholder="+234..."
                  type="tel"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold sm:col-span-2">
                Email address
                <input
                  className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal outline-none focus:border-ink"
                  name="email"
                  placeholder="you@example.com"
                  type="email"
                />
              </label>
            </div>

            <fieldset className="mt-7">
              <legend className="text-sm font-black">Fulfilment method</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="cursor-pointer rounded-2xl border border-ink/15 p-4 has-[:checked]:border-ink has-[:checked]:ring-2 has-[:checked]:ring-amber">
                  <input
                    className="mr-3"
                    defaultChecked
                    name="fulfilment"
                    type="radio"
                    value="delivery"
                  />
                  <span className="text-sm font-black">Lagos delivery</span>
                  <span className="mt-2 block pl-6 text-xs leading-5 text-muted">
                    Zone and fee confirmed from approved settings.
                  </span>
                </label>
                <label className="cursor-pointer rounded-2xl border border-ink/15 p-4 has-[:checked]:border-ink has-[:checked]:ring-2 has-[:checked]:ring-amber">
                  <input
                    className="mr-3"
                    name="fulfilment"
                    type="radio"
                    value="pickup"
                  />
                  <span className="text-sm font-black">Store pickup</span>
                  <span className="mt-2 block pl-6 text-xs leading-5 text-muted">
                    Address and opening hours pending approval.
                  </span>
                </label>
              </div>
            </fieldset>
          </section>

          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber/20 text-clay">
                <PackageCheck aria-hidden="true" size={19} />
              </span>
              <div>
                <p className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-muted">
                  Step 2
                </p>
                <h2 className="font-black">Payment method</h2>
              </div>
            </div>
            <div className="mt-7 grid gap-3">
              {[
                ['paystack', 'Pay online with Paystack', 'Card, bank, USSD, or enabled merchant methods'],
                ['pod', 'Pay on Delivery', 'Eligibility and deposit calculated by approved rules'],
                ['transfer', 'Manual Bank Transfer', 'Instructions shown only after valid order creation'],
              ].map(([value, label, description], methodIndex) => (
                <label
                  className="cursor-pointer rounded-2xl border border-ink/15 p-4 has-[:checked]:border-ink has-[:checked]:ring-2 has-[:checked]:ring-amber"
                  key={value}
                >
                  <input
                    className="mr-3"
                    defaultChecked={methodIndex === 0}
                    name="payment"
                    type="radio"
                    value={value}
                  />
                  <span className="text-sm font-black">{label}</span>
                  <span className="mt-2 block pl-6 text-xs leading-5 text-muted">
                    {description}
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-[1.75rem] bg-ink p-6 text-white sm:p-7 lg:sticky lg:top-28">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-amber">
            Order review
          </p>
          <div className="mt-6 grid gap-4">
            {cartLines.map((cartLine) => (
              <div className="flex gap-3" key={cartLine.variantId}>
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10">
                  <Image
                    className="object-cover"
                    src={cartLine.imagePath}
                    alt=""
                    fill
                    sizes="56px"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black">
                    {cartLine.productName}
                  </p>
                  <p className="mt-1 text-[0.68rem] text-white/45">
                    {cartLine.quantity} × {cartLine.variantName}
                  </p>
                </div>
                <p className="text-xs font-black">
                  {formatMoney(cartLine.lineTotalKobo)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-end justify-between gap-4 border-t border-white/15 pt-6">
            <p className="text-sm text-white/60">Subtotal</p>
            <p className="text-2xl font-black">{formatMoney(subtotalKobo)}</p>
          </div>
          <button
            className="mt-6 min-h-14 w-full cursor-not-allowed rounded-full bg-white/12 px-5 text-sm font-black text-white/45"
            disabled
            type="button"
          >
            Order connection pending
          </button>
          <p className="mt-4 text-[0.68rem] leading-5 text-white/45">
            Live order creation activates after Firebase, delivery rules,
            policies, and Paystack test credentials are configured.
          </p>
        </aside>
      </div>
    </div>
  );
}
