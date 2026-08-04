import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { retryPaystackPaymentAction } from '@/app/actions/checkout';
import { OrderFinancialPanel } from '@/app/orders/[reference]/confirmation/OrderFinancialPanel';

import { getOrderAccessProof } from '@/lib/services/carts/cartSession';
import { createOrderRepository } from '@/lib/repositories/orders/OrderRepository';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import { createTrackingService } from '@/lib/services/fulfilment/TrackingService';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Order confirmation',
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ payment?: string }>;
};

export default async function OrderConfirmationPage({ params, searchParams }: PageProps) {
  const [{ reference }, query, accessProof] = await Promise.all([
    params,
    searchParams,
    getOrderAccessProof(),
  ]);

  if (!accessProof) notFound();

  let snapshot;
  try {
    snapshot = await createOrderRepository().getByReference(reference, accessProof);
  } catch {
    notFound();
  }

  if (!snapshot) notFound();

  const { order, items, events, attempts } = snapshot;
  const ownerTracking = await createTrackingService()
    .lookupForOwner(reference, accessProof)
    .catch(() => null);
  const retryEligible = order.orderStatus === 'awaitingPayment' && attempts.some((attempt) => attempt.initialisationState === 'failed');
  const placedAt = new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(firestoreTimestampToDate(order.placedAt));

  return (
    <div className="shell py-12 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <p className="eyebrow text-clay">Order {order.reference}</p>
        <h1 className="display-type mt-5 text-5xl sm:text-6xl">
          {order.orderStatus === 'confirmed' ? 'Your order is confirmed.' : 'Your order is awaiting payment.'}
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
          Placed {placedAt}. A browser return does not prove payment; this page always shows the server-verified order state.
        </p>

        {query.payment === 'initialisation-failed' || query.payment === 'retry-failed' ? (
          <div className="mt-7 rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm" role="alert">
            <p className="font-black">Paystack could not be opened.</p>
            <p className="mt-2 text-muted">Your order and stock hold are safe until the displayed reservation expiry. No payment was recorded.</p>
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6 sm:p-8">
            <h2 className="text-xl font-black">Order items</h2>
            <div className="mt-5 grid gap-4">
              {items.map((item) => (
                <div className="flex justify-between gap-5 border-b border-ink/10 pb-4" key={item.id}>
                  <div>
                    <p className="font-black">{item.productName}</p>
                    <p className="mt-1 text-xs text-muted">{item.quantity} × {item.variantName} · {item.sku}</p>
                  </div>
                  <p className="font-black">{formatMoney(item.lineTotalKobo)}</p>
                </div>
              ))}
            </div>
            <h2 className="mt-8 text-xl font-black">Timeline</h2>
            <ol className="mt-5 grid gap-4">
              {events.map((event) => (
                <li className="border-l-2 border-amber pl-4" key={event.id}>
                  <p className="text-sm font-black">{event.customerLabel}</p>
                  {event.customerNote ? <p className="mt-1 text-xs text-muted">{event.customerNote}</p> : null}
                </li>
              ))}
            </ol>
          </section>

          <aside className="h-fit rounded-[1.75rem] bg-ink p-6 text-paper">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-amber">Verified status</p>
            <dl className="mt-5 grid gap-4 text-sm">
              <div><dt className="text-white/50">Order</dt><dd className="mt-1 font-black">{order.orderStatus}</dd></div>
              <div><dt className="text-white/50">Payment</dt><dd className="mt-1 font-black">{order.paymentStatus}</dd></div>
              <div><dt className="text-white/50">Fulfilment</dt><dd className="mt-1 font-black">{order.fulfilmentStatus}</dd></div>
              <div><dt className="text-white/50">Total</dt><dd className="mt-1 text-2xl font-black">{formatMoney(order.totals.grandTotalKobo)}</dd></div>
              <div><dt className="text-white/50">Outstanding</dt><dd className="mt-1 font-black">{formatMoney(order.totals.amountOutstandingKobo)}</dd></div>
            </dl>
            {retryEligible ? (
              <form action={retryPaystackPaymentAction} className="mt-6">
                <input name="orderId" type="hidden" value={order.id} />
                <input name="orderReference" type="hidden" value={order.reference} />
                <input name="cartId" type="hidden" value={order.cartId} />
                <input name="idempotencyKey" type="hidden" value={`paystack-retry:${randomUUID()}`} />
                <button className="w-full rounded-full bg-amber px-4 py-3 text-xs font-black text-ink" type="submit">Try Paystack again</button>
              </form>
            ) : null}
            <Link className="mt-7 inline-flex text-xs font-black underline" href="/shop">Continue shopping</Link>
          </aside>
        </div>
        {ownerTracking ? (
          <section className="mt-6 rounded-[1.75rem] border border-ink/10 bg-paper p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow text-clay">Live fulfilment tracking</p>
                <h2 className="mt-3 text-2xl font-black">{ownerTracking.statusLabel}</h2>
                <p className="mt-2 text-sm text-muted">
                  {ownerTracking.destinationLabel} · {ownerTracking.estimate.label}
                </p>
              </div>
              {ownerTracking.supportWhatsappUrl ? (
                <a
                  className="rounded-full border border-ink/15 px-4 py-2 text-xs font-black"
                  href={ownerTracking.supportWhatsappUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Contact support
                </a>
              ) : null}
            </div>
            <ol className="mt-6 grid gap-4">
              {ownerTracking.timeline.map((event) => (
                <li className="border-l-2 border-amber pl-4" key={event.id}>
                  <p className="text-sm font-black">{event.label}</p>
                  {event.note ? <p className="mt-1 text-xs text-muted">{event.note}</p> : null}
                  <time className="mt-1 block text-xs text-muted" dateTime={event.occurredAt}>
                    {new Intl.DateTimeFormat('en-NG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Africa/Lagos',
                    }).format(new Date(event.occurredAt))}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <OrderFinancialPanel order={order} proof={accessProof} />
      </div>
    </div>
  );
}

