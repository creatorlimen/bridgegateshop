import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  reportDeliveryExceptionAction,
  resolveDeliveryExceptionAction,
  revertDeliveryAction,
  transitionDeliveryAction,
} from '@/app/admin/delivery/actions';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { createDeliveryRepository } from '@/lib/repositories/fulfilment/DeliveryRepository';

export const metadata: Metadata = {
  title: 'Manage delivery',
  robots: { index: false, follow: false },
};

const field = 'min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm';
const button = 'rounded-full bg-ink px-5 py-3 text-xs font-black text-paper';

const nextStatuses = {
  delivery: {
    unfulfilled: 'preparing',
    preparing: 'dispatched',
    dispatched: 'outForDelivery',
    outForDelivery: 'delivered',
  },
  pickup: {
    unfulfilled: 'preparing',
    preparing: 'readyForPickup',
    readyForPickup: 'collected',
  },
} as const;

const previousStatuses = {
  delivery: {
    preparing: 'unfulfilled',
    dispatched: 'preparing',
    outForDelivery: 'dispatched',
    delivered: 'outForDelivery',
  },
  pickup: {
    preparing: 'unfulfilled',
    readyForPickup: 'preparing',
    collected: 'readyForPickup',
  },
} as const;

type PageProps = {
  params: Promise<{ deliveryId: string }>;
  searchParams: Promise<{ notice?: string }>;
};

export default async function AdminDeliveryDetailPage({ params, searchParams }: PageProps) {
  await requireStaffPermission('deliveries.read');
  const [{ deliveryId }, query] = await Promise.all([params, searchParams]);
  const snapshot = await createDeliveryRepository().getAdministrationSnapshot(deliveryId);
  if (!snapshot) notFound();
  const { delivery, order, events, exceptions } = snapshot;
  const forward = (nextStatuses[delivery.method] as Record<string, string | undefined>)[delivery.status];
  const previous = (previousStatuses[delivery.method] as Record<string, string | undefined>)[delivery.status];

  return (
    <section>
      <Link className="text-xs font-black underline" href="/admin/delivery">Back to deliveries</Link>
      <p className="eyebrow mt-7">{delivery.orderReference}</p>
      <h1 className="display-type mt-4 text-5xl">Manage {delivery.method}</h1>
      {query.notice ? <p className="mt-5 rounded-xl bg-amber/20 p-4 text-sm font-bold">{query.notice}</p> : null}
      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-5">
          <article className="rounded-2xl border border-ink/10 bg-paper p-6">
            <h2 className="text-xl font-black">Customer-visible history</h2>
            <ol className="mt-5 grid gap-4 border-l border-ink/15 pl-5">
              {events.map((event) => <li key={event.id}><p className="font-black">{event.customerLabel}</p>{event.customerNote ? <p className="mt-1 text-sm text-muted">{event.customerNote}</p> : null}</li>)}
              {events.length === 0 ? <li className="text-sm text-muted">No fulfilment transitions yet.</li> : null}
            </ol>
          </article>
          <article className="rounded-2xl border border-ink/10 bg-paper p-6">
            <h2 className="text-xl font-black">Exceptions</h2>
            <div className="mt-5 grid gap-4">
              {exceptions.map((exception) => (
                <div className="rounded-xl bg-canvas p-4" key={exception.id}>
                  <p className="font-black">{exception.type} · {exception.state}</p>
                  <p className="mt-1 text-sm text-muted">{exception.reason}</p>
                  {exception.state === 'open' ? (
                    <form action={resolveDeliveryExceptionAction} className="mt-4 grid gap-3">
                      <input name="deliveryId" type="hidden" value={delivery.id} />
                      <input name="exceptionId" type="hidden" value={exception.id} />
                      <input name="exceptionVersion" type="hidden" value={exception.version} />
                      <input name="idempotencyKey" type="hidden" value={`resolve-exception:${randomUUID()}`} />
                      <textarea className={`${field} py-3`} name="resolutionNote" placeholder="Resolution note" required />
                      <button className={button} type="submit">Resolve exception</button>
                    </form>
                  ) : null}
                </div>
              ))}
              {exceptions.length === 0 ? <p className="text-sm text-muted">No delivery exceptions.</p> : null}
            </div>
          </article>
        </div>
        <aside className="grid h-fit gap-5">
          <article className="rounded-2xl bg-ink p-6 text-paper">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-amber">Authoritative state</p>
            <dl className="mt-4 grid gap-3 text-sm">
              <div><dt className="text-white/50">Fulfilment</dt><dd className="font-black">{delivery.status}</dd></div>
              <div><dt className="text-white/50">Order</dt><dd className="font-black">{order.orderStatus}</dd></div>
              <div><dt className="text-white/50">Outstanding</dt><dd className="font-black">₦{(order.totals.amountOutstandingKobo / 100).toLocaleString('en-NG')}</dd></div>
              <div><dt className="text-white/50">Estimate</dt><dd className="font-black">{delivery.estimate.label}</dd></div>
            </dl>
          </article>
          {forward ? (
            <form action={transitionDeliveryAction} className="grid gap-3 rounded-2xl border border-ink/10 bg-paper p-5">
              <h2 className="font-black">Move to {forward}</h2>
              <TransitionHidden delivery={delivery} nextStatus={forward} orderVersion={order.version} />
              {forward === 'dispatched' ? <><input className={field} name="courierName" placeholder="Courier name" required /><input className={field} name="trackingReference" placeholder="Tracking reference" required /></> : null}
              <textarea className={`${field} py-3`} name="customerNote" placeholder="Customer note (optional)" />
              <textarea className={`${field} py-3`} name="internalNote" placeholder="Internal note (optional)" />
              <button className={button} type="submit">Apply guarded transition</button>
            </form>
          ) : null}
          {previous ? (
            <form action={revertDeliveryAction} className="grid gap-3 rounded-2xl border border-clay/20 bg-clay/10 p-5">
              <h2 className="font-black">Revert to {previous}</h2>
              <TransitionHidden delivery={delivery} nextStatus={previous} orderVersion={order.version} />
              <textarea className={`${field} py-3`} name="reason" placeholder="Required reason" required />
              <button className={button} type="submit">Revert one step</button>
            </form>
          ) : null}
          <form action={reportDeliveryExceptionAction} className="grid gap-3 rounded-2xl border border-ink/10 bg-paper p-5">
            <h2 className="font-black">Open exception</h2>
            <input name="deliveryId" type="hidden" value={delivery.id} />
            <input name="deliveryVersion" type="hidden" value={delivery.version} />
            <input name="idempotencyKey" type="hidden" value={`delivery-exception:${randomUUID()}`} />
            <select className={field} name="type"><option value="overdueEstimate">Overdue estimate</option><option value="invalidAddress">Invalid address or zone</option></select>
            <textarea className={`${field} py-3`} name="reason" placeholder="Operational reason" required />
            <button className={button} type="submit">Open exception</button>
          </form>
        </aside>
      </div>
    </section>
  );
}

function TransitionHidden({ delivery, nextStatus, orderVersion }: { delivery: { id: string; version: number }; nextStatus: string; orderVersion: number }) {
  return <><input name="deliveryId" type="hidden" value={delivery.id} /><input name="deliveryVersion" type="hidden" value={delivery.version} /><input name="orderVersion" type="hidden" value={orderVersion} /><input name="nextStatus" type="hidden" value={nextStatus} /><input name="idempotencyKey" type="hidden" value={`delivery-transition:${randomUUID()}`} /></>;
}
