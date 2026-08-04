import type { Metadata } from 'next';
import { Clock3, MapPin, PackageCheck, Store } from 'lucide-react';

import { loadFulfilmentSettings } from '@/lib/config/fulfilmentSettings';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Delivery and pickup',
  description: 'View the current Lagos delivery zones and store pickup model for BridgegateShop.',
};

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function DeliveryPage() {
  const settings = await loadFulfilmentSettings();
  const activeZones = settings.deliveryZones.filter(
    (zone) => zone.active && zone.deliveryEnabled,
  );

  return (
    <div className="shell py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow text-clay">Delivery & pickup</p>
        <h1 className="display-type mt-5 text-balance text-5xl leading-[0.98] sm:text-6xl">
          Clear windows, configured for Lagos.
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          Checkout calculates delivery from the selected zone, current service
          calendar, stock position, and Lagos cut-off time. The accepted fee
          and estimate are retained with every order.
        </p>
      </div>

      <section className="mt-12 grid gap-4 lg:grid-cols-3">
        {activeZones.map((zone, index) => (
          <article className="rounded-[1.75rem] border border-ink/10 bg-paper p-7" key={zone.id}>
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber/20 text-clay"><MapPin aria-hidden="true" size={20} /></span>
              <span className="text-xs font-black text-muted">Zone {String(index + 1).padStart(2, '0')}</span>
            </div>
            <h2 className="mt-7 text-xl font-black">{zone.name}</h2>
            <p className="mt-3 text-sm leading-6 text-muted">{zone.displayCopy}</p>
            <dl className="mt-5 grid gap-2 border-t border-ink/10 pt-5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Fee</dt><dd className="font-black">{formatMoney(zone.feeKobo)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Window</dt><dd className="font-black">{zone.minimumBusinessDays}?{zone.maximumBusinessDays} business days</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Service</dt><dd className="font-black">{zone.serviceDays.map((day) => dayNames[day]).join(', ')}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Same-day</dt><dd className="font-black">{zone.sameDayEnabled ? `Before ${zone.cutoffLocalTime}` : 'Not enabled'}</dd></div>
            </dl>
          </article>
        ))}
      </section>

      {settings.pickup.enabled ? (
        <section className="mt-8 rounded-[2rem] border border-ink/10 bg-paper p-7 sm:p-9">
          <Store aria-hidden="true" className="text-clay" size={24} />
          <h2 className="mt-5 text-2xl font-black">{settings.pickup.label}</h2>
          <p className="mt-3 text-sm leading-6 text-muted">{settings.pickup.address}</p>
          <p className="mt-2 text-sm font-bold">{settings.pickup.openingHours}</p>
          <p className="mt-2 text-xs text-muted">Preparation window: {settings.pickup.minimumPreparationBusinessDays}?{settings.pickup.maximumPreparationBusinessDays} business days.</p>
        </section>
      ) : null}

      <section className="mt-8 grid gap-px overflow-hidden rounded-[2rem] border border-ink/10 bg-ink/10 lg:grid-cols-3">
        {[
          { icon: Clock3, title: 'Cut-off aware', text: 'Exactly at the configured cut-off does not qualify for same-day service.' },
          { icon: PackageCheck, title: 'Order snapshots', text: 'The accepted delivery fee and estimate remain attached to the historical order.' },
          { icon: Store, title: 'Operational tracking', text: 'Status updates describe fulfilment progress and do not claim live GPS location.' },
        ].map((feature) => {
          const Icon = feature.icon;
          return <article className="bg-paper p-7" key={feature.title}><Icon aria-hidden="true" className="text-clay" size={22} /><h2 className="mt-5 font-black">{feature.title}</h2><p className="mt-2 text-sm leading-6 text-muted">{feature.text}</p></article>;
        })}
      </section>
    </div>
  );
}
