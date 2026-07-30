import { ArrowUpRight, Clock3, Mail, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';

import { siteConfig } from '@/lib/config/site';

import { BrandMark } from './BrandMark';

const footerGroups = [
  {
    title: 'Shop',
    links: [
      { href: '/shop', label: 'All products' },
      { href: '/shop/category/pop-paint', label: 'POP Paint' },
      { href: '/shop/category/white-bond', label: 'White Bond' },
      { href: '/calculator', label: 'Material calculator' },
      { href: '/bulk-quote', label: 'Bulk quote' },
    ],
  },
  {
    title: 'Help',
    links: [
      { href: '/delivery', label: 'Delivery & pickup' },
      { href: '/track-order', label: 'Track an order' },
      { href: '/returns-refunds', label: 'Returns & refunds' },
      { href: '/contact', label: 'Contact us' },
      { href: '/about', label: 'About Specta' },
    ],
  },
  {
    title: 'Policies',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/returns-refunds', label: 'Returns policy' },
      { href: '/delivery', label: 'Delivery policy' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-ink text-white">
      <div className="shell grid gap-14 py-16 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <BrandMark inverse />
          <p className="mt-6 max-w-md text-base leading-7 text-white/62">
            Building finishing materials, practical project support, and
            dependable fulfilment for Lagos.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-white/65">
            <a
              className="flex items-start gap-3 hover:text-white"
              href={siteConfig.contact.phoneHref}
            >
              <Phone aria-hidden="true" className="mt-0.5" size={17} />
              {siteConfig.contact.phoneDisplay}
            </a>
            <a
              className="flex items-start gap-3 hover:text-white"
              href={`mailto:${siteConfig.contact.email}`}
            >
              <Mail aria-hidden="true" className="mt-0.5" size={17} />
              {siteConfig.contact.email}
            </a>
            <p className="flex items-start gap-3">
              <MapPin aria-hidden="true" className="mt-0.5" size={17} />
              {siteConfig.contact.address}
            </p>
            <p className="flex items-start gap-3">
              <Clock3 aria-hidden="true" className="mt-0.5" size={17} />
              {siteConfig.contact.openingHours}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
          {footerGroups.map((footerGroup) => (
            <div key={footerGroup.title}>
              <h2 className="text-xs font-black uppercase tracking-[0.18em] text-amber">
                {footerGroup.title}
              </h2>
              <ul className="mt-5 grid gap-3">
                {footerGroup.links.map((footerLink) => (
                  <li key={`${footerGroup.title}-${footerLink.href}`}>
                    <Link
                      className="inline-flex items-center gap-1 text-sm text-white/62 hover:text-white"
                      href={footerLink.href}
                    >
                      {footerLink.label}
                      <ArrowUpRight
                        aria-hidden="true"
                        className="opacity-40"
                        size={13}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="shell flex flex-col gap-2 py-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Specta. All rights reserved.
          </p>
          <p>{siteConfig.placeholderNotice}</p>
        </div>
      </div>
    </footer>
  );
}
