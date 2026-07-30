import type { Metadata } from 'next';
import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';

import { SignInForm } from '@/app/components/auth/SignInForm';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignInPage() {
  return (
    <div className="shell py-16">
      <div className="mx-auto max-w-md rounded-[2rem] border border-ink/10 bg-paper p-7 shadow-card sm:p-9">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber/20 text-clay">
          <LockKeyhole aria-hidden="true" size={22} />
        </span>
        <h1 className="display-type mt-7 text-5xl">Welcome back.</h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Sign in through Firebase Authentication, then continue with a
          protected server-verified session.
        </p>
        <SignInForm />
        <p className="mt-6 text-center text-xs text-muted">
          New customer?{' '}
          <Link className="font-black text-ink underline" href="/shop">
            Continue shopping as a guest
          </Link>
        </p>
      </div>
    </div>
  );
}
