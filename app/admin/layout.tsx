import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getActiveStaffContext } from '@/lib/auth/authorization';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const staffContext = await getActiveStaffContext();

  if (!staffContext) {
    redirect('/account');
  }

  return (
    <div className="shell py-10">
      <div className="rounded-[2rem] bg-ink p-6 text-paper sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber">
              Staff workspace
            </p>
            <p className="mt-2 text-sm text-paper/70">
              Signed in as{' '}
              {staffContext.membership.displayName ??
                staffContext.session.email ??
                'Staff member'}
            </p>
          </div>
          <Link
            className="rounded-full border border-paper/25 px-4 py-2 text-xs font-black"
            href="/account"
          >
            Customer account
          </Link>
        </div>
      </div>
      <main className="py-8">{children}</main>
    </div>
  );
}
