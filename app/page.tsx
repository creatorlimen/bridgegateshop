import {
  ArrowRight,
  BadgeCheck,
  Calculator,
  Check,
  ChevronRight,
  Clock3,
  Layers3,
  MapPin,
  PackageCheck,
  ShieldCheck,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { ProductCard } from '@/app/components/commerce/ProductCard';
import { SectionHeading } from '@/app/components/ui/SectionHeading';
import {
  productCategories,
  products,
} from '@/lib/data/placeholder-catalogue';

const trustItems = [
  {
    icon: ShieldCheck,
    title: 'Server-checked',
    description: 'Prices and stock are designed to be revalidated before orders.',
  },
  {
    icon: MapPin,
    title: 'Built for Lagos',
    description: 'Delivery zones, pickup, and cut-offs are configuration-led.',
  },
  {
    icon: PackageCheck,
    title: 'Project ready',
    description: 'From single-room finishes to structured bulk requests.',
  },
];

const orderingSteps = [
  {
    number: '01',
    title: 'Choose the right finish',
    description:
      'Compare variants, pack sizes, current availability, and practical usage notes.',
  },
  {
    number: '02',
    title: 'Confirm quantity & delivery',
    description:
      'Use the calculator for an estimate, then select delivery or store pickup.',
  },
  {
    number: '03',
    title: 'Pay & follow progress',
    description:
      'Complete an eligible payment method and follow each fulfilment milestone.',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="shell pb-8 pt-6 sm:pt-8">
        <div className="relative isolate min-h-[36rem] overflow-hidden rounded-[2rem] bg-ink sm:min-h-[39rem] lg:min-h-[42rem]">
          <Image
            className="hero-image object-cover object-[67%_center] opacity-55 lg:object-center lg:opacity-80"
            src="/images/storefront-hero.png"
            alt="Two building professionals reviewing finish samples in a prepared interior"
            fill
            priority
            sizes="(max-width: 1200px) 100vw, 1200px"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/90 to-ink/5 lg:via-ink/65" />
          <div className="paper-grid absolute inset-y-0 left-0 w-[58%] opacity-[0.12]" />

          <div className="relative z-10 flex min-h-[36rem] items-center px-6 py-14 sm:min-h-[39rem] sm:px-10 lg:min-h-[42rem] lg:px-16">
            <div className="max-w-2xl text-white">
              <p className="eyebrow text-amber">Built for the work</p>
              <h1 className="display-type mt-6 text-balance text-[3.25rem] leading-[0.94] sm:text-6xl lg:text-[5.25rem]">
                Finishes that move projects forward.
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
                Shop trusted building finishes, estimate what you need, and
                coordinate delivery—all from one practical Lagos-focused
                platform.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link className="button-primary" href="/shop">
                  Shop materials
                  <ArrowRight aria-hidden="true" size={18} />
                </Link>
                <Link
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/25 px-5 text-sm font-extrabold text-white transition hover:border-white hover:bg-white hover:text-ink"
                  href="/bulk-quote"
                >
                  Request a bulk quote
                </Link>
              </div>

              <dl className="mt-12 grid max-w-xl grid-cols-3 gap-3 border-t border-white/18 pt-6">
                <div>
                  <dt className="text-[0.62rem] font-bold uppercase tracking-[0.13em] text-white/45">
                    Launch focus
                  </dt>
                  <dd className="mt-2 text-sm font-black sm:text-base">
                    2 categories
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.62rem] font-bold uppercase tracking-[0.13em] text-white/45">
                    Market
                  </dt>
                  <dd className="mt-2 text-sm font-black sm:text-base">
                    Lagos
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.62rem] font-bold uppercase tracking-[0.13em] text-white/45">
                    Currency
                  </dt>
                  <dd className="mt-2 text-sm font-black sm:text-base">
                    Nigerian Naira
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="absolute bottom-6 right-6 hidden items-center gap-3 rounded-2xl border border-white/15 bg-ink/55 p-3 text-white backdrop-blur-md md:flex">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber text-ink">
              <Clock3 aria-hidden="true" size={19} />
            </span>
            <span className="pr-2">
              <span className="block text-[0.62rem] font-bold uppercase tracking-[0.12em] text-white/45">
                Store hours
              </span>
              <span className="mt-1 block text-xs font-extrabold">
                Placeholder schedule
              </span>
            </span>
          </div>
        </div>
      </section>

      <section className="shell grid gap-px overflow-hidden rounded-[1.75rem] border border-ink/10 bg-ink/10 md:grid-cols-3">
        {trustItems.map((trustItem) => {
          const TrustIcon = trustItem.icon;

          return (
            <div
              className="flex items-start gap-4 bg-paper p-6 sm:p-7"
              key={trustItem.title}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber/18 text-clay">
                <TrustIcon aria-hidden="true" size={21} />
              </span>
              <div>
                <h2 className="text-sm font-black">{trustItem.title}</h2>
                <p className="mt-1.5 text-xs leading-5 text-muted">
                  {trustItem.description}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      <section className="shell py-24">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Featured materials"
            title="A focused catalogue for better finishes."
            description="Launch products are shown with placeholder commercial data until Specta supplies the approved catalogue."
          />
          <Link
            className="inline-flex shrink-0 items-center gap-2 text-sm font-black hover:text-clay"
            href="/shop"
          >
            View all products
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>

        <div className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {products
            .filter((product) => product.featured)
            .slice(0, 4)
            .map((product) => (
              <ProductCard product={product} key={product.id} />
            ))}
        </div>
      </section>

      <section className="border-y border-ink/10 bg-paper py-24">
        <div className="shell">
          <SectionHeading
            eyebrow="Shop by category"
            title="Two essentials. Built to grow."
            description="The launch catalogue starts deliberately focused. New categories can be added without changing the application structure."
          />

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {productCategories.map((category, categoryIndex) => (
              <Link
                className="group relative isolate min-h-[23rem] overflow-hidden rounded-[2rem] border border-ink/10 p-7 sm:p-10"
                href={`/shop/category/${category.slug}`}
                key={category.id}
              >
                <Image
                  className="object-cover transition duration-700 group-hover:scale-105"
                  src={
                    categoryIndex === 0
                      ? '/images/pop-paint-placeholder.png'
                      : '/images/white-bond-placeholder.png'
                  }
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
                <div className="relative flex h-full min-h-[18rem] flex-col justify-end text-white">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber">
                    0{categoryIndex + 1} · Launch category
                  </p>
                  <div className="mt-4 flex items-end justify-between gap-5">
                    <div>
                      <h3 className="display-type text-4xl sm:text-5xl">
                        {category.name}
                      </h3>
                      <p className="mt-3 max-w-md text-sm leading-6 text-white/65">
                        {category.description}
                      </p>
                    </div>
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber text-ink transition group-hover:rotate-[-12deg] group-hover:scale-105">
                      <ArrowRight aria-hidden="true" size={20} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="shell py-24">
        <SectionHeading
          eyebrow="How ordering works"
          title="From material choice to site delivery."
          description="A short customer journey with honest states, clear next actions, and no hidden browser-calculated totals."
        />
        <ol className="mt-12 grid gap-4 lg:grid-cols-3">
          {orderingSteps.map((orderingStep) => (
            <li
              className="relative overflow-hidden rounded-[1.75rem] border border-ink/10 bg-paper p-7 sm:p-8"
              key={orderingStep.number}
            >
              <span className="display-type absolute -right-2 -top-7 text-[7rem] text-ink/[0.045]">
                {orderingStep.number}
              </span>
              <span className="text-xs font-black uppercase tracking-[0.15em] text-clay">
                Step {orderingStep.number}
              </span>
              <h3 className="mt-12 text-xl font-black tracking-[-0.025em]">
                {orderingStep.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted">
                {orderingStep.description}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="shell grid overflow-hidden rounded-[2rem] bg-[#ddd5c6] lg:grid-cols-[1fr_0.95fr]">
        <div className="paper-grid p-8 sm:p-12 lg:p-16">
          <p className="eyebrow text-clay">Material calculator</p>
          <h2 className="display-type mt-5 max-w-xl text-balance text-4xl leading-[1.02] sm:text-5xl">
            Estimate smarter before you order.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-ink/65">
            Enter surface dimensions, choose a compatible product, and get an
            estimated quantity with a configurable wastage allowance.
          </p>
          <ul className="mt-8 grid gap-3 text-sm font-bold sm:grid-cols-2">
            {[
              'Ceilings, walls, and floors',
              'Whole-unit rounding',
              'Current price estimate',
              'Clear assumptions',
            ].map((feature) => (
              <li className="flex items-center gap-2.5" key={feature}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-moss text-white">
                  <Check aria-hidden="true" size={13} />
                </span>
                {feature}
              </li>
            ))}
          </ul>
          <Link className="button-dark mt-9" href="/calculator">
            Try the calculator
            <Calculator aria-hidden="true" size={18} />
          </Link>
        </div>
        <div className="relative min-h-[25rem] overflow-hidden bg-ink p-8 text-white sm:p-12">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full border-[3rem] border-amber/15" />
          <div className="absolute bottom-10 right-10 h-36 w-36 rotate-12 rounded-3xl bg-clay/40" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber text-ink">
              <Layers3 aria-hidden="true" size={29} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.15em] text-white/45">
                Example estimate
              </p>
              <p className="display-type mt-3 text-7xl">42 m²</p>
              <div className="mt-5 flex items-center gap-3 border-t border-white/15 pt-5">
                <BadgeCheck aria-hidden="true" className="text-amber" size={21} />
                <p className="text-sm text-white/60">
                  Assumptions remain visible before adding to cart.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="shell pt-24">
        <div className="relative overflow-hidden rounded-[2rem] bg-clay px-7 py-12 text-white sm:px-12 sm:py-14 lg:flex lg:items-center lg:justify-between lg:gap-12">
          <div className="absolute -bottom-20 -left-14 h-56 w-56 rounded-full border-[2.5rem] border-white/10" />
          <div className="relative max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">
              Planning a larger project?
            </p>
            <h2 className="display-type mt-4 text-balance text-4xl leading-none sm:text-5xl">
              Send the list. Let Specta structure the supply.
            </h2>
            <p className="mt-5 text-base leading-7 text-white/70">
              Submit project quantities, location, and timing. The sales team
              can organise the request and respond with a clear reference.
            </p>
          </div>
          <Link
            className="relative mt-8 inline-flex min-h-14 shrink-0 items-center gap-3 rounded-full bg-white px-6 text-sm font-black text-ink transition hover:-translate-y-1 lg:mt-0"
            href="/bulk-quote"
          >
            Start a bulk request
            <ChevronRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}
