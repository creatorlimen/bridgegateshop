'use client';

import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';

import {
  createServerSession,
  deleteServerSession,
} from '@/lib/auth/client/sessionClient';
import { hasFirebaseClientEnvironment } from '@/lib/config/clientEnvironment';
import { getFirebaseClientAuth } from '@/lib/firebase/client';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isFirebaseConfigured = hasFirebaseClientEnvironment();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(undefined);
    setIsSubmitting(true);

    try {
      const firebaseAuth = await getFirebaseClientAuth();
      const userCredential = await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim(),
        password,
      );
      const idToken = await userCredential.user.getIdToken(true);

      await createServerSession(idToken);
      await signOut(firebaseAuth);
      router.replace('/account');
      router.refresh();
    } catch {
      try {
        await deleteServerSession();
      } catch {
        // The server may not have created a session. Keep the customer error safe.
      }

      setErrorMessage('Unable to sign in with those credentials.');
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-black">
        Email address
        <input
          autoComplete="email"
          className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
          disabled={!isFirebaseConfigured || isSubmitting}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </label>
      <label className="grid gap-2 text-sm font-black">
        Password
        <input
          autoComplete="current-password"
          className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal"
          disabled={!isFirebaseConfigured || isSubmitting}
          minLength={6}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          required
          type="password"
          value={password}
        />
      </label>
      {errorMessage ? (
        <p
          className="rounded-xl bg-clay/10 p-3 text-sm font-bold text-clay"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        className="button-dark min-h-14 disabled:cursor-not-allowed disabled:bg-ink/15 disabled:text-ink/45"
        disabled={!isFirebaseConfigured || isSubmitting}
        type="submit"
      >
        {isSubmitting ? 'Establishing secure session...' : 'Sign in securely'}
      </button>
      {!isFirebaseConfigured ? (
        <p className="text-xs leading-5 text-muted">
          Firebase client configuration is pending for this environment.
        </p>
      ) : null}
    </form>
  );
}
