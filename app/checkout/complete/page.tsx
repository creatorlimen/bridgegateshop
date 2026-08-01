import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOrderAccessProof } from '@/lib/services/carts/cartSession';
import { resolvePaystackReturnToOrder } from '@/lib/services/orders/resolvePaymentReturn';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = {
  title: 'Payment return',
  robots: { index: false, follow: false },
};

type CheckoutCompletePageProps = {
  searchParams: Promise<{ reference?: string }>;
};

export default async function CheckoutCompletePage({
  searchParams,
}: CheckoutCompletePageProps) {
  const [{ reference }, accessProof] = await Promise.all([
    searchParams,
    getOrderAccessProof(),
  ]);
  const orderReference = reference && accessProof
    ? await resolvePaystackReturnToOrder(reference, accessProof)
    : null;

  if (orderReference) redirect(`/orders/${orderReference}/confirmation`);
  return (
    <div className="shell py-16">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-ink/10 bg-paper p-8 text-center">
        <p className="eyebrow text-clay">Payment return</p>
        <h1 className="display-type mt-5 text-5xl">We are verifying your payment.</h1>
        <p className="mt-5 text-sm leading-6 text-muted">
          This browser return does not mark an order paid. Paystack’s signed webhook and server verification update the authoritative order state.
        </p>
        <Link className="button-primary mt-7" href="/shop">Return to shop</Link>
      </div>
    </div>
  );
}

