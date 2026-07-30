import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import Link from 'next/link';

import { adjustInventoryFormAction } from '@/app/admin/inventory/actions';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { createInventoryAdminRepository } from '@/lib/repositories/inventory/InventoryAdminRepository';
import { firestoreTimestampToDate } from '@/lib/schemas/common';

export const metadata: Metadata = {
  title: 'Inventory administration',
  robots: {
    index: false,
    follow: false,
  },
};

type InventoryAdminPageProps = {
  searchParams: Promise<{
    notice?: string;
    error?: string;
    requestId?: string;
  }>;
};

function formatInventoryTime(
  timestamp: Parameters<typeof firestoreTimestampToDate>[0],
) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(firestoreTimestampToDate(timestamp));
}

export default async function InventoryAdminPage({
  searchParams,
}: InventoryAdminPageProps) {
  const [staffContext, snapshot, resolvedSearchParams] =
    await Promise.all([
      requireStaffPermission('inventory.read'),
      createInventoryAdminRepository().getSnapshot(),
      searchParams,
    ]);
  const canAdjust = staffContext.permissions.has('inventory.adjust');
  const managedLines = snapshot.lines.filter(
    (line) => line.variant.stockManaged,
  );
  const lowStockLines = managedLines.filter(
    (line) =>
      !line.balance ||
      line.balance.stockState === 'lowStock' ||
      line.balance.stockState === 'outOfStock',
  );

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Inventory operations</p>
          <h1 className="display-type mt-4 text-5xl sm:text-6xl">
            Balances and reservations
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
            On-hand, reserved, and available units are maintained per
            managed variant. Every physical adjustment creates an immutable
            movement and audit event.
          </p>
        </div>
        <Link className="button-dark" href="/admin/catalogue">
          Open catalogue
        </Link>
      </div>

      {resolvedSearchParams.notice || resolvedSearchParams.error ? (
        <div
          className={
            resolvedSearchParams.error
              ? 'mt-8 rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm'
              : 'mt-8 rounded-2xl border border-moss/20 bg-moss/10 p-5 text-sm'
          }
          role={resolvedSearchParams.error ? 'alert' : 'status'}
        >
          <p className="font-black">
            {resolvedSearchParams.error ?? resolvedSearchParams.notice}
          </p>
          {resolvedSearchParams.error &&
          resolvedSearchParams.requestId ? (
            <p className="mt-2 text-xs text-muted">
              Support reference: {resolvedSearchParams.requestId}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          ['Managed variants', managedLines.length],
          ['Low or out of stock', lowStockLines.length],
          ['Active reservations', snapshot.activeReservations.length],
        ].map(([label, value]) => (
          <article
            className="rounded-2xl border border-ink/10 bg-paper p-5"
            key={label}
          >
            <p className="text-xs font-black uppercase tracking-[0.12em] text-muted">
              {label}
            </p>
            <p className="mt-3 text-3xl font-black">{value}</p>
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="grid gap-4">
          {managedLines.map(({ product, variant, balance }) => (
            <article
              className="rounded-[1.5rem] border border-ink/10 bg-paper p-5"
              key={variant.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-clay">
                    {variant.sku}
                  </p>
                  <h2 className="mt-2 text-lg font-black">
                    {product.name} · {variant.name}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    Balance version {balance?.version ?? 0} · threshold{' '}
                    {variant.lowStockThreshold}
                  </p>
                </div>
                <span className="rounded-full bg-ink/8 px-3 py-2 text-xs font-black uppercase">
                  {balance?.stockState ?? 'outOfStock'}
                </span>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ['On hand', balance?.onHand ?? 0],
                  ['Reserved', balance?.reserved ?? 0],
                  ['Available', balance?.available ?? 0],
                ].map(([label, value]) => (
                  <div className="rounded-xl bg-canvas p-3" key={label}>
                    <dt className="text-[0.65rem] font-black uppercase tracking-[0.1em] text-muted">
                      {label}
                    </dt>
                    <dd className="mt-2 text-xl font-black">{value}</dd>
                  </div>
                ))}
              </dl>

              {canAdjust && variant.status !== 'archived' ? (
                <form
                  action={adjustInventoryFormAction}
                  className="mt-5 grid gap-3 border-t border-ink/10 pt-5 sm:grid-cols-2"
                >
                  <input name="variantId" type="hidden" value={variant.id} />
                  <input
                    name="expectedVersion"
                    type="hidden"
                    value={balance?.version ?? 0}
                  />
                  <input
                    name="idempotencyKey"
                    type="hidden"
                    value={`inventory-adjust:${randomUUID()}`}
                  />
                  <label className="grid gap-2 text-xs font-black">
                    Signed quantity
                    <input
                      className="min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm"
                      name="quantityDelta"
                      placeholder="e.g. 25 or -3"
                      required
                      type="number"
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-black">
                    Movement type
                    <select
                      className="min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm"
                      defaultValue="receipt"
                      name="movementType"
                    >
                      <option value="receipt">Receipt</option>
                      <option value="return">Return</option>
                      <option value="damage">Damage</option>
                      <option value="correction">Correction</option>
                      <option value="reversal">Reversal</option>
                    </select>
                  </label>
                  <label className="grid gap-2 text-xs font-black sm:col-span-2">
                    Reason
                    <input
                      className="min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm"
                      maxLength={500}
                      minLength={3}
                      name="reason"
                      required
                    />
                  </label>
                  <button
                    className="rounded-full bg-ink px-4 py-3 text-xs font-black text-white sm:col-span-2"
                    type="submit"
                  >
                    Post adjustment
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>

        <div className="grid content-start gap-6">
          <section className="rounded-[1.5rem] bg-ink p-6 text-paper">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-amber">
              Active reservations
            </p>
            <div className="mt-5 grid gap-3">
              {snapshot.activeReservations.length > 0 ? (
                snapshot.activeReservations.map((reservation) => (
                  <article
                    className="rounded-xl border border-white/10 p-4"
                    key={reservation.id}
                  >
                    <p className="text-xs font-black">
                      {reservation.lines.length} line reservation
                    </p>
                    <p className="mt-2 text-[0.7rem] text-white/50">
                      Expires {formatInventoryTime(reservation.expiresAt)}
                    </p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-white/55">
                  No active reservation holds.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-ink/10 bg-paper p-6">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Recent movements
            </p>
            <div className="mt-5 grid gap-3">
              {snapshot.recentMovements.slice(0, 20).map((movement) => (
                <article
                  className="rounded-xl bg-canvas p-4"
                  key={movement.id}
                >
                  <div className="flex justify-between gap-3 text-xs">
                    <p className="font-black">{movement.type}</p>
                    <p
                      className={
                        movement.quantityEffect > 0
                          ? 'font-black text-moss'
                          : 'font-black text-clay'
                      }
                    >
                      {movement.quantityEffect > 0 ? '+' : ''}
                      {movement.quantityEffect}
                    </p>
                  </div>
                  <p className="mt-2 text-[0.7rem] text-muted">
                    {movement.reason}
                  </p>
                </article>
              ))}
              {snapshot.recentMovements.length === 0 ? (
                <p className="text-sm text-muted">
                  No physical movements recorded yet.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
