import type { Metadata } from 'next';
import Link from 'next/link';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createDeliveryRepository } from '@/lib/repositories/fulfilment/DeliveryRepository';

export const metadata: Metadata = {
  title: 'Delivery operations',
  robots: { index: false, follow: false },
};

export default async function AdminDeliveryPage() {
  await requireStaffPermission('deliveries.read');
  const deliveries = await createDeliveryRepository().listForAdministration();
  return (
    <section>
      <p className="eyebrow">Lagos fulfilment</p>
      <h1 className="display-type mt-4 text-5xl">Delivery operations</h1>
      <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">
        Move orders through guarded delivery or pickup states and resolve operational exceptions.
      </p>
      <div className="mt-8 grid gap-4">
        {deliveries.map((delivery) => (
          <Link
            className="grid gap-4 rounded-2xl border border-ink/10 bg-paper p-5 transition hover:-translate-y-0.5 sm:grid-cols-[1fr_auto] sm:items-center"
            href={`/admin/delivery/${delivery.id}`}
            key={delivery.id}
          >
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">{delivery.orderReference}</p>
              <h2 className="mt-2 text-lg font-black">{delivery.status} · {delivery.method}</h2>
              <p className="mt-1 text-sm text-muted">{delivery.estimate.label}</p>
            </div>
            <p className="text-sm font-black">
              {delivery.openExceptionCount > 0
                ? `${delivery.openExceptionCount} open exception${delivery.openExceptionCount === 1 ? '' : 's'}`
                : 'No open exceptions'}
            </p>
          </Link>
        ))}
        {deliveries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink/20 p-8 text-sm text-muted">No delivery records have been created yet.</p>
        ) : null}
      </div>
    </section>
  );
}
