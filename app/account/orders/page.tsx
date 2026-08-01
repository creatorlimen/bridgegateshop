import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentSession } from '@/lib/auth/session';
import { createOrderRepository } from '@/lib/repositories/orders/OrderRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'My orders', robots: { index: false, follow: false } };

export default async function AccountOrdersPage() {
  const session = await getCurrentSession({ checkRevoked: true });
  if (!session) redirect('/auth/sign-in');
  const orders = await createOrderRepository().listForCustomer(session.uid);

  return (
    <div className="shell py-12 sm:py-16">
      <p className="eyebrow">Secure account</p>
      <h1 className="display-type mt-4 text-5xl sm:text-6xl">Your orders</h1>
      <div className="mt-8 grid gap-4">
        {orders.length ? orders.map((order) => (
          <Link className="rounded-2xl border border-ink/10 bg-paper p-5 transition hover:border-ink/30" href={`/orders/${order.reference}/confirmation`} key={order.id}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><p className="text-xs font-black uppercase tracking-[0.12em] text-clay">{order.reference}</p><p className="mt-2 font-black">{order.orderStatus} · {order.paymentStatus}</p></div>
              <p className="text-xl font-black">{formatMoney(order.totals.grandTotalKobo)}</p>
            </div>
          </Link>
        )) : <div className="rounded-2xl bg-paper p-6 text-sm text-muted">No orders have been placed on this account yet.</div>}
      </div>
    </div>
  );
}

