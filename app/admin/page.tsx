import type { Metadata } from 'next';
import Link from 'next/link';

import { getActiveStaffContext } from '@/lib/auth/authorization';

export const metadata: Metadata = {
  title: 'Staff workspace',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminPage() {
  const staffContext = await getActiveStaffContext();

  if (!staffContext) {
    return null;
  }

  return (
    <section>
      <p className="eyebrow">Authorisation foundation</p>
      <h1 className="display-type mt-4 text-5xl sm:text-6xl">
        Operations dashboard
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
        The staff shell is active. Operational modules will only appear when
        their matching server-resolved permission is present.
      </p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <article className="rounded-2xl border border-ink/10 bg-paper p-6">
          <h2 className="text-lg font-black">Assigned roles</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            {staffContext.membership.roleIds.join(', ')}
          </p>
        </article>
        <article className="rounded-2xl border border-ink/10 bg-paper p-6">
          <h2 className="text-lg font-black">Resolved permissions</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            {staffContext.permissions.size} server-enforced capabilities
          </p>
        </article>
        {staffContext.permissions.has('catalogue.read') ? (
          <Link
            className="rounded-2xl border border-ink/10 bg-ink p-6 text-paper transition hover:-translate-y-1"
            href="/admin/catalogue"
          >
            <p className="text-xs font-black uppercase tracking-[0.14em] text-amber">
              Catalogue
            </p>
            <h2 className="mt-3 text-xl font-black">Manage products →</h2>
            <p className="mt-2 text-sm text-paper/60">
              Categories, product content, variants, media, and publication.
            </p>
          </Link>
        ) : null}
        {staffContext.permissions.has('inventory.read') ? (
          <Link
            className="rounded-2xl border border-ink/10 bg-paper p-6 transition hover:-translate-y-1"
            href="/admin/inventory"
          >
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Inventory
            </p>
            <h2 className="mt-3 text-xl font-black">
              Manage stock →
            </h2>
            <p className="mt-2 text-sm text-muted">
              Balances, reservations, adjustments, and movement history.
            </p>
          </Link>
        ) : null}
        {staffContext.permissions.has('deliveries.read') ? (
          <Link
            className="rounded-2xl border border-ink/10 bg-paper p-6 transition hover:-translate-y-1"
            href="/admin/delivery"
          >
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Fulfilment
            </p>
            <h2 className="mt-3 text-xl font-black">Manage deliveries →</h2>
            <p className="mt-2 text-sm text-muted">
              Delivery and pickup transitions, tracking, and exceptions.
            </p>
          </Link>
        ) : null}
        {staffContext.permissions.has('settings.commerce.write') ? (
          <Link
            className="rounded-2xl border border-ink/10 bg-paper p-6 transition hover:-translate-y-1"
            href="/admin/settings/fulfilment"
          >
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Settings
            </p>
            <h2 className="mt-3 text-xl font-black">Configure fulfilment →</h2>
            <p className="mt-2 text-sm text-muted">
              Versioned zones, fees, service days, cut-offs, pickup, and calendar.
            </p>
          </Link>
        ) : null}
        {staffContext.permissions.has('settings.commerce.write') ? (
          <Link
            className="rounded-2xl border border-ink/10 bg-paper p-6 transition hover:-translate-y-1"
            href="/admin/settings/notifications"
          >
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Notifications
            </p>
            <h2 className="mt-3 text-xl font-black">Configure messages →</h2>
            <p className="mt-2 text-sm text-muted">
              Provider health, channel policy, and customer message templates.
            </p>
          </Link>
        ) : null}
      </div>
    </section>
  );
}
