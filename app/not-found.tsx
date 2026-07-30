import { ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <div className="shell py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="display-type text-[9rem] leading-none text-ink/10">404</p>
        <h1 className="display-type -mt-5 text-5xl">This route needs a new map.</h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted">
          The page may have moved, the product may be unavailable, or the link
          may be incomplete.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link className="button-primary" href="/">
            <ArrowLeft aria-hidden="true" size={17} />
            Return home
          </Link>
          <Link className="button-secondary" href="/search">
            <Search aria-hidden="true" size={17} />
            Search products
          </Link>
        </div>
      </div>
    </div>
  );
}
