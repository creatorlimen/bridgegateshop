import {
  ChevronDown,
  Menu,
  Phone,
  Search,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';

import { siteConfig } from '@/lib/config/site';

import { BrandMark } from './BrandMark';

export function SiteHeader() {
  return (
    <>
      <div className="bg-ink py-2 text-center text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/75">
        <div className="shell flex items-center justify-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          Preview build · placeholder business data
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-canvas/95 backdrop-blur">
        <div className="shell flex h-[4.7rem] items-center justify-between gap-5">
          <BrandMark />

          <nav
            className="hidden items-center gap-7 lg:flex"
            aria-label="Primary navigation"
          >
            {siteConfig.navigation.map((navigationItem) => (
              <Link
                className="text-sm font-bold text-ink/75 transition hover:text-ink"
                href={navigationItem.href}
                key={navigationItem.href}
              >
                {navigationItem.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-1 md:flex">
            <Link
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition hover:bg-paper"
              href="/search"
              aria-label="Search products"
            >
              <Search aria-hidden="true" size={19} />
            </Link>
            <Link
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition hover:bg-paper"
              href="/auth/sign-in"
              aria-label="Sign in"
            >
              <UserRound aria-hidden="true" size={19} />
            </Link>
            <Link
              className="ml-1 flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-bold text-white transition hover:bg-ink/85"
              href="/cart"
            >
              <ShoppingBag aria-hidden="true" size={17} />
              Cart
            </Link>
          </div>

          <details className="group relative lg:hidden">
            <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border border-ink/15 [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" size={20} />
              <span className="sr-only">Open navigation menu</span>
            </summary>
            <div className="absolute right-0 top-14 w-[min(21rem,calc(100vw-2rem))] rounded-3xl border border-ink/10 bg-paper p-4 shadow-lift">
              <nav className="grid gap-1" aria-label="Mobile navigation">
                {siteConfig.navigation.map((navigationItem) => (
                  <Link
                    className="flex min-h-12 items-center justify-between rounded-2xl px-4 font-bold hover:bg-canvas"
                    href={navigationItem.href}
                    key={navigationItem.href}
                  >
                    {navigationItem.label}
                    <ChevronDown
                      aria-hidden="true"
                      className="-rotate-90"
                      size={17}
                    />
                  </Link>
                ))}
                <div className="my-2 border-t border-ink/10" />
                <Link
                  className="flex min-h-12 items-center gap-3 rounded-2xl px-4 font-bold hover:bg-canvas"
                  href="/search"
                >
                  <Search aria-hidden="true" size={18} />
                  Search
                </Link>
                <Link
                  className="flex min-h-12 items-center gap-3 rounded-2xl px-4 font-bold hover:bg-canvas"
                  href="/cart"
                >
                  <ShoppingBag aria-hidden="true" size={18} />
                  Cart
                </Link>
                <a
                  className="mt-2 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-amber px-4 font-black text-ink"
                  href={siteConfig.contact.phoneHref}
                >
                  <Phone aria-hidden="true" size={18} />
                  Call Specta
                </a>
              </nav>
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
