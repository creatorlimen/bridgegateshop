import { randomUUID } from 'node:crypto';

import Link from 'next/link';

import { requestRefundAction } from '@/app/actions/orderPayments';
import { TransferEvidenceUpload } from '@/app/orders/[reference]/confirmation/TransferEvidenceUpload';
import { loadCheckoutSettings } from '@/lib/config/checkoutSettings';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';
import { createOrderFinancialRepository } from '@/lib/repositories/orders/OrderFinancialRepository';
import type { OrderRecord } from '@/lib/schemas/order';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export async function OrderFinancialPanel({
  order,
  proof,
}: {
  order: OrderRecord;
  proof: OrderAccessProof;
}) {
  const [snapshot, settings] = await Promise.all([
    createOrderFinancialRepository().getCustomerSnapshot(order, proof),
    loadCheckoutSettings(),
  ]);
  const refundableKobo =
    order.totals.amountPaidKobo - order.refundTotalKobo - order.refundPendingKobo;
  const refundablePayment = snapshot.payments.find(
    (payment) => payment.state === 'succeeded',
  );

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      {snapshot.transferInstructions ? (
        <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-clay">
            Protected transfer instructions
          </p>
          <h2 className="mt-3 text-xl font-black">Complete your bank transfer</h2>
          <dl className="mt-5 grid gap-3 text-sm">
            <div><dt className="text-muted">Bank</dt><dd className="font-black">{snapshot.transferInstructions.bankName}</dd></div>
            <div><dt className="text-muted">Account name</dt><dd className="font-black">{snapshot.transferInstructions.accountName}</dd></div>
            <div><dt className="text-muted">Account number</dt><dd className="font-black">{snapshot.transferInstructions.accountNumber}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-muted">{snapshot.transferInstructions.customerMessage}</p>
          <p className="mt-3 text-xs font-black">Use {order.reference} as the narration. Evidence never proves payment; authorised staff must verify the bank transaction.</p>
          {settings.manualTransfer.evidenceUploadEnabled ? (
            <TransferEvidenceUpload orderId={order.id} />
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6">
        <h2 className="text-xl font-black">Invoices, receipts, and refunds</h2>
        <div className="mt-5 grid gap-3">
          {snapshot.documents.map((document) => (
            <Link className="rounded-xl bg-canvas p-4 text-sm font-black underline" href={`/api/financial-documents/${document.id}`} key={document.id}>
              {document.documentNumber} · {document.documentType} · {formatMoney(document.amountKobo)}
            </Link>
          ))}
          {!snapshot.documents.length ? <p className="text-sm text-muted">Documents appear here after order acceptance or successful payment.</p> : null}
        </div>
        {snapshot.refunds.length ? (
          <div className="mt-6 border-t border-ink/10 pt-5">
            <p className="text-sm font-black">Refund requests</p>
            {snapshot.refunds.map((refund) => <p className="mt-2 text-xs text-muted" key={refund.id}>{formatMoney(refund.amountKobo)} · {refund.state} · {refund.reason}</p>)}
          </div>
        ) : null}
        {refundableKobo > 0 && refundablePayment ? (
          <form action={requestRefundAction} className="mt-6 grid gap-3 border-t border-ink/10 pt-5">
            <p className="text-sm font-black">Request a refund</p>
            <input name="orderId" type="hidden" value={order.id} />
            <input name="orderReference" type="hidden" value={order.reference} />
            <input name="paymentId" type="hidden" value={refundablePayment.id} />
            <input name="idempotencyKey" type="hidden" value={`refund-request:${randomUUID()}`} />
            <input className="min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm" defaultValue={(Math.min(refundableKobo, refundablePayment.amountKobo) / 100).toFixed(2)} name="amountNaira" required />
            <textarea className="min-h-24 rounded-xl border border-ink/15 bg-canvas p-3 text-sm" name="reason" placeholder="Reason for the request" required />
            <button className="rounded-full bg-ink px-4 py-3 text-xs font-black text-paper" type="submit">Submit refund request</button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
