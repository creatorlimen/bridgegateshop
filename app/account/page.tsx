import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/app/components/auth/SignOutButton';
import { getCurrentSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'My account',
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AccountPage() {
  const session = await getCurrentSession({ checkRevoked: true });

  if (!session) {
    redirect('/auth/sign-in');
  }

  return (
    <div className="shell py-16">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-ink/10 bg-paper p-7 shadow-card sm:p-9">
        <p className="eyebrow">Secure account</p>
        <h1 className="display-type mt-4 text-5xl sm:text-6xl">
          Your Bridgegate account
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
          This page is rendered on the server after validating your Firebase
          session cookie. Customer tools will be connected here in the next
          commerce stages.
        </p>
        <dl className="mt-8 grid gap-4 rounded-2xl bg-canvas p-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-black text-muted">Email</dt>
            <dd className="mt-1 font-bold">
              {session.email ?? 'No email on this account'}
            </dd>
          </div>
          <div>
            <dt className="font-black text-muted">Verification</dt>
            <dd className="mt-1 font-bold">
              {session.emailVerified ? 'Verified' : 'Not verified'}
            </dd>
          </div>
        </dl>
        <div className="mt-8">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
