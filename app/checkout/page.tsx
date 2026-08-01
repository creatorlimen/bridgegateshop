import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import Link from 'next/link';

import { CheckoutOrderForm } from '@/app/checkout/CheckoutOrderForm';
import { getCheckoutSettings } from '@/lib/config/checkoutSettings';
import { getCurrentCart } from '@/lib/services/carts/authoritativeCart';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

type CheckoutPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function CheckoutPage({
  searchParams,
}: CheckoutPageProps) {
  const [cart, resolvedSearchParams] = await Promise.all([
    getCurrentCart(),
    searchParams,
  ]);

  if (cart.lines.length === 0) {
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
          <p className="eyebrow text-clay">Checkout</p>
          <h1 className="display-type mt-5 text-5xl sm:text-6xl">
            Delivery and payment.
          </h1>
        </div>
        <p className="text-xs font-bold text-muted">
          Price, delivery, and stock revalidated at order creation
        </p>
      </div>

      {!cart.readyForCheckout ? (
        <div
          className="mb-8 rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm"
          role="alert"
        >
          <p className="font-black">The cart changed and cannot continue yet.</p>
          <p className="mt-2 text-muted">
            Return to the cart to review current prices, unavailable items,
            or adjusted stock.
          </p>
          <Link className="mt-4 inline-flex text-xs font-black underline" href="/cart">
            Review cart
          </Link>
        </div>
      ) : null}

      <CheckoutOrderForm
        cart={cart}
        checkoutSettings={getCheckoutSettings()}
        errorMessage={resolvedSearchParams.error}
        idempotencyKey={`checkout:${randomUUID()}`}
      />
    </div>
  );
}
