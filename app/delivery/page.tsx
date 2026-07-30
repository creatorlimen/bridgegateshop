import type { Metadata } from 'next';
import { Clock3, MapPin, PackageCheck, Store } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Delivery and pickup',
  description:
    'Preview the configurable Lagos delivery and store pickup model for BridgegateShop.',
};

const placeholderZones = [
  {
    name: 'Lagos Island',
    note: 'Areas, fees, service days, and same-day rules pending approval.',
  },
  {
    name: 'Lagos Mainland',
    note: 'Areas, fees, service days, and same-day rules pending approval.',
  },
  {
    name: 'Outskirts & satellite towns',
    note: 'Supported areas and delivery windows pending approval.',
  },
];

export default function DeliveryPage() {
  return (
    <div className="shell py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow text-clay">Delivery & pickup</p>
        <h1 className="display-type mt-5 text-balance text-5xl leading-[0.98] sm:text-6xl">
          Clear windows, configured for Lagos.
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          Checkout will calculate delivery from the selected zone, service
          calendar, stock position, and Lagos cut-off time. Final fees and
          service promises are still awaiting Specta approval.
        </p>
      </div>

      <section className="mt-12 grid gap-4 lg:grid-cols-3">
        {placeholderZones.map((deliveryZone, deliveryZoneIndex) => (
          <article
            className="rounded-[1.75rem] border border-ink/10 bg-paper p-7"
            key={deliveryZone.name}
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber/20 text-clay">
                <MapPin aria-hidden="true" size={20} />
              </span>
              <span className="text-xs font-black text-muted">
                Zone 0{deliveryZoneIndex + 1}
              </span>
            </div>
            <h2 className="mt-7 text-xl font-black">{deliveryZone.name}</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              {deliveryZone.note}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-8 grid gap-px overflow-hidden rounded-[2rem] border border-ink/10 bg-ink/10 lg:grid-cols-3">
        {[
          {
            icon: Clock3,
            title: 'Cut-off aware',
            text: 'Exactly at the configured cut-off does not qualify for same-day delivery by proposed default.',
          },
          {
            icon: PackageCheck,
            title: 'Order snapshots',
            text: 'The accepted delivery fee and estimate remain attached to the historical order.',
          },
          {
            icon: Store,
            title: 'Store pickup',
            text: 'Pickup excludes the delivery fee and follows approved address and opening-hour settings.',
          },
        ].map((deliveryFeature) => {
          const DeliveryIcon = deliveryFeature.icon;

          return (
            <article className="bg-paper p-7" key={deliveryFeature.title}>
              <DeliveryIcon
                aria-hidden="true"
                className="text-clay"
                size={22}
              />
              <h2 className="mt-5 font-black">{deliveryFeature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {deliveryFeature.text}
              </p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
