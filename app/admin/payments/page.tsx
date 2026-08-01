import type { Metadata } from 'next';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createPaymentAdminRepository } from '@/lib/repositories/payments/PaymentAdminRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const metadata: Metadata = {
  title: 'Payment reconciliation',
  robots: { index: false, follow: false },
};

export default async function AdminPaymentsPage() {
  await requireStaffPermission('orders.read');
  const snapshot = await createPaymentAdminRepository().getSnapshot();
  const openExceptions = snapshot.exceptions.filter(
    (exception) => exception.state === 'open',
  );

  return (
    <section>
      <p className="eyebrow">Payment operations</p>
      <h1 className="display-type mt-4 text-5xl sm:text-6xl">Paystack reconciliation</h1>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
        Verified postings are append-only. Amount, currency, reference, late-payment, and order-state mismatches remain isolated here for controlled resolution.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-4">
        {[
          ['Attempts', snapshot.attempts.length],
          ['Successful postings', snapshot.payments.filter((payment) => payment.state === 'succeeded').length],
          ['Open exceptions', openExceptions.length],
          ['Webhook receipts', snapshot.webhookEvents.length],
        ].map(([label, value]) => (
          <article className="rounded-2xl border border-ink/10 bg-paper p-5" key={label}>
            <p className="text-xs font-black uppercase tracking-[0.1em] text-muted">{label}</p>
            <p className="mt-3 text-3xl font-black">{value}</p>
          </article>
        ))}
      </div>

      <section className="mt-8 rounded-[1.75rem] border border-ink/10 bg-paper p-6">
        <h2 className="text-xl font-black">Open exceptions</h2>
        <div className="mt-5 grid gap-3">
          {openExceptions.length ? openExceptions.map((exception) => (
            <article className="rounded-xl bg-canvas p-4" key={exception.id}>
              <div className="flex flex-wrap justify-between gap-3"><p className="font-black">{exception.reasonCode}</p><p className="text-xs font-black text-clay">{exception.providerReference}</p></div>
              <p className="mt-2 text-xs text-muted">Expected {exception.expectedAmountKobo === null ? 'unknown' : formatMoney(exception.expectedAmountKobo)} · received {exception.receivedAmountKobo === null ? 'unknown' : formatMoney(exception.receivedAmountKobo)}</p>
            </article>
          )) : <p className="text-sm text-muted">No open payment exceptions.</p>}
        </div>
      </section>

      <section className="mt-8 overflow-x-auto rounded-2xl border border-ink/10 bg-paper">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink text-paper"><tr><th className="p-4">Reference</th><th className="p-4">State</th><th className="p-4">Order</th><th className="p-4 text-right">Intended amount</th></tr></thead>
          <tbody>{snapshot.attempts.map((attempt) => <tr className="border-b border-ink/10" key={attempt.id}><td className="p-4 font-black">{attempt.providerReference}</td><td className="p-4">{attempt.initialisationState}</td><td className="p-4">{attempt.orderReference}</td><td className="p-4 text-right font-black">{formatMoney(attempt.intendedAmountKobo)}</td></tr>)}</tbody>
        </table>
      </section>
    </section>
  );
}

