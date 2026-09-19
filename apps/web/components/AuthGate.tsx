'use client';

import { useEffect, useState } from 'react';

import { BottomNav } from '@/components/BottomNav';
import { BrandGlyph } from '@/components/Header';
import { useAccount } from '@/lib/account';
import {
  hasOnboarded,
  hasStoredCredential,
  markOnboarded,
  reauthenticate,
  registerAccount,
  sessionIsFresh,
  storeDisplayName,
} from '@/lib/session';

/**
 * The web equivalent of the phone app's `onboarding/index.tsx` +
 * `lock.tsx`: an unauthenticated visitor never reaches a page that calls
 * `useStore()` (which would just hang on the pending gateway forever) —
 * they see this instead, a passkey prompt, not a page. A signed-in visitor
 * whose session has gone stale sees the same "confirm it's you" prompt
 * `lock.tsx` shows, re-checked on every tab-visibility change the way the
 * phone app re-checks on every `AppState` foreground event.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { account, setAccount } = useAccount();
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [step, setStep] = useState<'marketing' | 'name'>('marketing');
  const [name, setName] = useState('');

  useEffect(() => {
    function check() {
      // "Returning" needs a saved passkey as well as the onboarded flag — the
      // sign-in below can only confirm a passkey that exists.
      setOnboarded(hasOnboarded() && hasStoredCredential());
    }
    check();
  }, []);

  useEffect(() => {
    function check() {
      if (document.visibilityState !== 'visible') return;
      setStale(!sessionIsFresh());
    }
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [account]);

  if (account && !stale) {
    return (
      <>
        {children}
        <BottomNav />
      </>
    );
  }

  async function onboard() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setProblem(null);
    const result = await registerAccount('Entole account');
    setBusy(false);
    if (result.ok) {
      storeDisplayName(trimmed);
      markOnboarded();
      setOnboarded(true);
      setStale(false);
      setAccount({ ...result.account, displayName: trimmed });
    } else {
      setProblem(result.reason);
    }
  }

  async function signIn() {
    setBusy(true);
    setProblem(null);
    const result = await reauthenticate();
    setBusy(false);
    if (result.ok) {
      setStale(false);
      setAccount(result.account);
    } else {
      setProblem(result.reason);
    }
  }

  const showNameStep = !onboarded && step === 'name';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col items-center justify-center px-gutter-lg">
      <BrandGlyph size={40} />

      {onboarded ? (
        <>
          <h1 className="mt-6 text-center font-strong text-headline text-ink">Confirm it&apos;s you</h1>
          <p className="mt-2 text-center font-body text-body-sm text-slate">
            Your session timed out. Nothing here moves until you do.
          </p>
        </>
      ) : showNameStep ? (
        <>
          <h1 className="mt-6 text-center font-strong text-headline text-ink">
            What should we call you?
          </h1>
          <p className="mt-2 text-center font-body text-body-sm text-slate">
            This is how Entole greets you — nothing else sees it.
          </p>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            autoFocus
            autoComplete="name"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onboard();
            }}
            className="mt-6 h-14 w-full rounded-control border-[1.5px] border-indigo bg-card px-4 font-strong text-body-lg text-ink outline-none"
          />
        </>
      ) : (
        <>
          <h1 className="mt-6 text-center font-strong text-headline text-ink">
            Money that moves like a message
          </h1>
          <p className="mt-2 text-center font-body text-body-sm text-slate">
            Send naira home, share costs with friends, and set limits Entole will keep for you.
            No password to remember — unlocking your device is the key.
          </p>
        </>
      )}

      {problem ? <p className="mt-4 text-center font-body text-label-sm text-halt">{problem}</p> : null}

      <button
        type="button"
        disabled={busy || (showNameStep && !name.trim())}
        onClick={() => void (onboarded ? signIn() : showNameStep ? onboard() : setStep('name'))}
        className="mt-8 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
      >
        {busy
          ? 'Confirming'
          : onboarded
            ? 'Sign in with passkey'
            : showNameStep
              ? 'Continue with passkey'
              : 'Continue'}
      </button>

      {!onboarded ? (
        <p className="mt-3.5 text-center font-body text-caption text-mist">
          By continuing you agree to our terms and privacy notice.
        </p>
      ) : null}
    </main>
  );
}
