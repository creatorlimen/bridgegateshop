import type { Metadata } from 'next';

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
      </div>
    </section>
  );
}
