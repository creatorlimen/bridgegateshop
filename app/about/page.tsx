import type { Metadata } from 'next';
import { ArrowRight, Building2, Layers3, UsersRound } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About Specta',
  description:
    'Learn about the placeholder product direction for Specta and BridgegateShop.',
};

export default function AboutPage() {
  return (
    <div className="shell py-12 sm:py-16">
      <section className="grid gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-end">
        <div>
          <p className="eyebrow text-clay">About Specta</p>
          <h1 className="display-type mt-5 text-balance text-5xl leading-[0.96] sm:text-7xl">
            A practical platform for how building work gets done.
          </h1>
        </div>
        <div>
          <p className="text-base leading-7 text-muted">
            BridgegateShop is being built as Specta&apos;s owned commerce and
            customer-service platform for building finishing materials. The
            final company story and approved public claims will replace this
            placeholder narrative.
          </p>
          <Link className="button-primary mt-7" href="/shop">
            Explore the catalogue
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </section>

      <section className="mt-16 grid gap-4 lg:grid-cols-3">
        {[
          {
            icon: Building2,
            title: 'Focused commerce',
            text: 'A Specta-operated store, not a multi-vendor marketplace.',
          },
          {
            icon: Layers3,
            title: 'Project support',
            text: 'Quantity estimates, structured quotes, guidance, and order visibility.',
          },
          {
            icon: UsersRound,
            title: 'Built for the trade',
            text: 'Mobile-first flows for contractors, site managers, retailers, and property owners.',
          },
        ].map((value) => {
          const ValueIcon = value.icon;

          return (
            <article
              className="rounded-[1.75rem] bg-paper p-7"
              key={value.title}
            >
              <ValueIcon aria-hidden="true" className="text-clay" size={25} />
              <h2 className="mt-8 text-xl font-black">{value.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{value.text}</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
