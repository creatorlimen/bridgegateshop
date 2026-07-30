'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { deleteServerSession } from '@/lib/auth/client/sessionClient';

export function SignOutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignOut() {
    setIsSubmitting(true);

    try {
      await deleteServerSession();
      router.replace('/auth/sign-in');
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <button
      className="button-secondary"
      disabled={isSubmitting}
      onClick={handleSignOut}
      type="button"
    >
      <LogOut aria-hidden="true" size={16} />
      {isSubmitting ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
