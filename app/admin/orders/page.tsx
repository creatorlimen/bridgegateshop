import type { Metadata } from 'next';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createOrderRepository } from '@/lib/repositories/orders/OrderRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const metadata: Metadata = { title: 'Order administration', robots: { index: false, follow: false } };

export default async function AdminOrdersPage() {
  await requireStaffPermission('orders.read');
  const orders = await createOrderRepository().listForAdministration();

  return (
    <section>
      <p className="eyebrow">Order operations</p>
      <h1 className="display-type mt-4 text-5xl sm:text-6xl">Orders and payment state</h1>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">Order, payment, and fulfilment remain separate authoritative dimensions. This queue is read-only until guarded transition actions are introduced.</p>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-ink/10 bg-paper">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-ink text-paper"><tr><th className="p-4">Reference</th><th className="p-4">Customer</th><th className="p-4">Order</th><th className="p-4">Payment</th><th className="p-4">Fulfilment</th><th className="p-4 text-right">Total</th></tr></thead>
          <tbody>{orders.map((order) => <tr className="border-b border-ink/10" key={order.id}><td className="p-4 font-black">{order.reference}</td><td className="p-4">{order.customer.fullName}</td><td className="p-4">{order.orderStatus}</td><td className="p-4">{order.paymentStatus}</td><td className="p-4">{order.fulfilmentStatus}</td><td className="p-4 text-right font-black">{formatMoney(order.totals.grandTotalKobo)}</td></tr>)}</tbody>
        </table>
        {!orders.length ? <p className="p-6 text-sm text-muted">No orders have been placed.</p> : null}
      </div>
    </section>
  );
}

