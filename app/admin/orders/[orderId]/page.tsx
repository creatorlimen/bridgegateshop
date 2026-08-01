import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  acceptReturnedStockAction,
  approvePodOrderAction,
  cancelOrderAction,
  processRefundAction,
  recordManualTransferAction,
  recordPodCollectionAction,
  recordRefundOutcomeAction,
  reviewRefundAction,
} from '@/app/admin/orders/actions';
import { TransferEvidenceAdminList } from '@/app/admin/orders/[orderId]/TransferEvidenceAdminList';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { createOrderFinancialRepository } from '@/lib/repositories/orders/OrderFinancialRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const metadata: Metadata = {
  title: 'Order operations',
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ notice?: string }>;
};

const fieldClass = 'min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm';
const buttonClass = 'rounded-full bg-ink px-4 py-3 text-xs font-black text-paper';

export default async function AdminOrderDetailPage({ params, searchParams }: PageProps) {
  await requireStaffPermission('orders.read');
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const snapshot = await createOrderFinancialRepository().getAdministrationSnapshot(orderId);
  if (!snapshot) notFound();
  const { order, items, payments, refunds, documents, events } = snapshot;
  const paymentAction =
    order.paymentSelection.method === 'manualTransfer'
      ? recordManualTransferAction
      : recordPodCollectionAction;
  const canRecordPayment =
    order.totals.amountOutstandingKobo > 0 &&
    (order.paymentSelection.method === 'manualTransfer' ||
      (order.paymentSelection.method === 'pod' && ['confirmed', 'processing'].includes(order.orderStatus)));

  return (
    <section>
      <Link className="text-xs font-black underline" href="/admin/orders">Back to orders</Link>
      <p className="eyebrow mt-7">{order.reference}</p>
      <h1 className="display-type mt-4 text-5xl">Order operations</h1>
      {query.notice ? <p className="mt-5 rounded-xl bg-amber/20 p-4 text-sm font-bold">{query.notice}</p> : null}

      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-5">
          <article className="rounded-2xl border border-ink/10 bg-paper p-6">
            <h2 className="text-xl font-black">Immutable order snapshot</h2>
            <p className="mt-2 text-sm text-muted">{order.customer.fullName} · {order.customer.email} · {order.customer.phone}</p>
            <div className="mt-5 grid gap-3">
              {items.map((item) => <div className="flex justify-between gap-4 border-b border-ink/10 pb-3 text-sm" key={item.id}><span>{item.quantity} × {item.productName} — {item.variantName}</span><strong>{formatMoney(item.lineTotalKobo)}</strong></div>)}
            </div>
          </article>

          <article className="rounded-2xl border border-ink/10 bg-paper p-6">
            <h2 className="text-xl font-black">Payments and documents</h2>
            <div className="mt-4 grid gap-3 text-sm">
              {payments.map((payment) => <p key={payment.id}><strong>{formatMoney(payment.amountKobo)}</strong> · {payment.method} · {payment.providerTransactionId}</p>)}
              {!payments.length ? <p className="text-muted">No payment has been posted.</p> : null}
              {documents.map((document) => <Link className="font-black underline" href={`/api/financial-documents/${document.id}`} key={document.id}>{document.documentNumber} ({document.documentType})</Link>)}
              <TransferEvidenceAdminList orderId={order.id} />
            </div>
          </article>

          <article className="rounded-2xl border border-ink/10 bg-paper p-6">
            <h2 className="text-xl font-black">Refund workflow</h2>
            <div className="mt-5 grid gap-5">
              {refunds.map((refund) => (
                <div className="rounded-xl bg-canvas p-4" key={refund.id}>
                  <p className="font-black">{formatMoney(refund.amountKobo)} · {refund.state}</p>
                  <p className="mt-1 text-xs text-muted">{refund.reason}</p>
                  {refund.state === 'requested' ? (
                    <form action={reviewRefundAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                      <CommonHidden order={order} />
                      <input name="refundId" type="hidden" value={refund.id} />
                      <input name="idempotencyKey" type="hidden" value={`refund-review:${randomUUID()}`} />
                      <input className={`${fieldClass} sm:col-span-2`} name="resolutionNote" placeholder="Review reason" required />
                      <button className={buttonClass} name="decision" type="submit" value="approved">Approve</button>
                      <button className={buttonClass} name="decision" type="submit" value="rejected">Reject</button>
                    </form>
                  ) : null}
                  {refund.state === 'approved' ? (
                    <form action={processRefundAction} className="mt-4">
                      <input name="orderId" type="hidden" value={order.id} />
                      <input name="refundId" type="hidden" value={refund.id} />
                      <button className={buttonClass} type="submit">Move to processing</button>
                    </form>
                  ) : null}
                  {refund.state === 'processing' ? (
                    <form action={recordRefundOutcomeAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                      <input name="orderId" type="hidden" value={order.id} />
                      <input name="refundId" type="hidden" value={refund.id} />
                      <input name="idempotencyKey" type="hidden" value={`refund-outcome:${randomUUID()}`} />
                      <input className={fieldClass} defaultValue={refund.providerRefundId ?? ''} name="providerRefundId" placeholder="Provider/refund reference" required />
                      <input className={fieldClass} name="resolutionNote" placeholder="Reconciliation note" required />
                      <button className={buttonClass} name="outcome" type="submit" value="processed">Record processed</button>
                      <button className={buttonClass} name="outcome" type="submit" value="failed">Record failed</button>
                    </form>
                  ) : null}
                  {refund.state === 'processed' && refund.stockDecision === 'notRestocked' ? (
                    <form action={acceptReturnedStockAction} className="mt-4 grid gap-3">
                      <input name="orderId" type="hidden" value={order.id} />
                      <input name="refundId" type="hidden" value={refund.id} />
                      <textarea className={`${fieldClass} py-3`} name="reason" placeholder="Physical return inspection and sellable-stock reason" required />
                      <button className={buttonClass} type="submit">
                        Accept physical return and restock full order
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
              {!refunds.length ? <p className="text-sm text-muted">No refund requests.</p> : null}
            </div>
          </article>

          <article className="rounded-2xl border border-ink/10 bg-paper p-6">
            <h2 className="text-xl font-black">Customer-visible timeline</h2>
            <ol className="mt-4 grid gap-3">{events.map((event) => <li className="border-l-2 border-amber pl-3 text-sm" key={event.id}><strong>{event.customerLabel}</strong>{event.customerNote ? <span className="block text-xs text-muted">{event.customerNote}</span> : null}</li>)}</ol>
          </article>
        </div>

        <aside className="grid h-fit gap-5">
          <article className="rounded-2xl bg-ink p-6 text-paper">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-amber">Authoritative state</p>
            <dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-white/50">Order</dt><dd className="font-black">{order.orderStatus}</dd></div><div><dt className="text-white/50">Payment</dt><dd className="font-black">{order.paymentStatus}</dd></div><div><dt className="text-white/50">Paid</dt><dd className="font-black">{formatMoney(order.totals.amountPaidKobo)}</dd></div><div><dt className="text-white/50">Outstanding</dt><dd className="font-black">{formatMoney(order.totals.amountOutstandingKobo)}</dd></div><div><dt className="text-white/50">Refund pending</dt><dd className="font-black">{formatMoney(order.refundPendingKobo)}</dd></div></dl>
          </article>

          {order.paymentSelection.method === 'pod' && order.paymentSelection.depositKobo === 0 && order.orderStatus === 'pending' ? (
            <form action={approvePodOrderAction} className="rounded-2xl border border-ink/10 bg-paper p-5">
              <h2 className="font-black">Approve POD</h2>
              <CommonHidden order={order} />
              <input name="idempotencyKey" type="hidden" value={`pod-approval:${randomUUID()}`} />
              <button className={`${buttonClass} mt-4 w-full`} type="submit">Approve and commit stock</button>
            </form>
          ) : null}

          {canRecordPayment ? (
            <form action={paymentAction} className="grid gap-3 rounded-2xl border border-ink/10 bg-paper p-5">
              <h2 className="font-black">Record verified payment</h2>
              <CommonHidden order={order} />
              <input name="idempotencyKey" type="hidden" value={`offline-payment:${randomUUID()}`} />
              <input className={fieldClass} defaultValue={(order.totals.amountOutstandingKobo / 100).toFixed(2)} name="amountNaira" required />
              <input className={fieldClass} name="externalReference" placeholder="External reference" required />
              <input className={fieldClass} name="transactionDate" required type="datetime-local" />
              <input className={fieldClass} name="evidenceId" placeholder="Evidence ID (optional)" />
              <textarea className={`${fieldClass} py-3`} name="note" placeholder="Internal note" />
              <button className={buttonClass} type="submit">Post payment</button>
            </form>
          ) : null}

          {!['cancelled', 'completed'].includes(order.orderStatus) ? (
            <form action={cancelOrderAction} className="grid gap-3 rounded-2xl border border-clay/20 bg-clay/10 p-5">
              <h2 className="font-black">Controlled cancellation</h2>
              <CommonHidden order={order} />
              <input name="idempotencyKey" type="hidden" value={`order-cancel:${randomUUID()}`} />
              <textarea className={`${fieldClass} py-3`} name="reason" placeholder="Cancellation reason" required />
              <button className={buttonClass} type="submit">Cancel with guards</button>
            </form>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function CommonHidden({ order }: { order: { id: string; version: number } }) {
  return <><input name="orderId" type="hidden" value={order.id} /><input name="orderVersion" type="hidden" value={order.version} /></>;
}
