'use client';

import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  USERNAME_MAX,
  normalizeUsername,
  suggestUsername,
  validateFullName,
  validateUsername,
} from '@entole/core/profile';

import { BottomNav } from '@/components/BottomNav';
import { BrandGlyph } from '@/components/Header';
import { Landing } from '@/components/Landing';
import { LogoLoader, PageLoader } from '@/components/LogoLoader';
import { useAccount, type SignedInAccount } from '@/lib/account';
import {
  hasOnboarded,
  hasStoredCredential,
  markOnboarded,
  reauthenticate,
  registerAccount,
  sessionIsFresh,
  signInWithExistingPasskey,
  storeProfile,
} from '@/lib/session';

/**
 * The web equivalent of the phone app's `onboarding/index.tsx` +
 * `lock.tsx`: an unauthenticated visitor never reaches a page that calls
 * `useStore()` (which would just hang on the pending gateway forever) —
 * they see this instead, a passkey prompt, not a page. A signed-in visitor
 * whose session has gone stale sees the same "confirm it's you" prompt
 * `lock.tsx` shows, re-checked on every tab-visibility change the way the
 * phone app re-checks on every `AppState` foreground event.
 *
 * A device that has never seen the account can still get into it: "I already
 * have an account" asks for the passkey the account was made with and makes
 * nothing new. Without it, every new device made a new, empty account.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { account, setAccount } = useAccount();
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Null until this browser's own record has been read. Until then nothing is
  // said: a returning person used to see the newcomer's screen flash past.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [step, setStep] = useState<'marketing' | 'name'>('marketing');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [touched, setTouched] = useState(false);
  // Signed in with a passkey from elsewhere, but this device has no name for
  // them yet. Held here until they give one; nothing is shown as signed in.
  const [returning, setReturning] = useState<SignedInAccount | null>(null);

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
        {/* From 1024px the navigation runs along the top; the page starts under it. */}
        <div className="lg:pt-[68px] lg:[&>main]:min-h-[calc(100dvh-68px)]">{children}</div>
        <BottomNav />
      </>
    );
  }

  const nameError = validateFullName(name);
  const usernameError = validateUsername(username);
  const detailsValid = !nameError && !usernameError;

  function onNameChange(next: string) {
    setName(next);
    if (!usernameEdited) setUsername(suggestUsername(next));
  }

  function onUsernameChange(next: string) {
    setUsernameEdited(true);
    setUsername(normalizeUsername(next));
  }

  async function onboard() {
    setTouched(true);
    if (!detailsValid) return;
    const profile = { fullName: name.trim(), username };
    if (returning) {
      // The account exists already. Only this device's copy of the name is new.
      storeProfile(profile);
      markOnboarded();
      setOnboarded(true);
      setStale(false);
      setAccount({ ...returning, displayName: profile.fullName, username: profile.username });
      setReturning(null);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await registerAccount('Entole account');
    setBusy(false);
    if (result.ok) {
      storeProfile(profile);
      markOnboarded();
      setOnboarded(true);
      setStale(false);
      setAccount({ ...result.account, displayName: profile.fullName, username: profile.username });
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

  async function signInFromElsewhere() {
    setBusy(true);
    setProblem(null);
    const result = await signInWithExistingPasskey();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    if (result.account.displayName) {
      markOnboarded();
      setOnboarded(true);
      setStale(false);
      setAccount(result.account);
      return;
    }
    setReturning(result.account);
    setStep('name');
  }

  const showNameStep = onboarded === false && step === 'name';
  const firstScreen = onboarded === false && step === 'marketing';

  // Nothing is known about this browser yet: the mark, and nothing else.
  if (onboarded === null) return <PageLoader />;

  // Someone with no account here gets the whole first page, at any width.
  if (firstScreen) {
    return (
      <Landing
        busy={busy}
        problem={problem}
        onStart={() => {
          setProblem(null);
          setStep('name');
        }}
        onSignIn={() => void signInFromElsewhere()}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col px-gutter-lg">
      <header className="flex h-16 flex-none items-center gap-2.5">
        {showNameStep && !returning ? (
          <button
            type="button"
            aria-label="Go back"
            onClick={() => {
              setStep('marketing');
              setProblem(null);
            }}
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded-pill text-slate transition-colors hover:bg-press hover:text-ink"
          >
            <ArrowLeft size={22} strokeWidth={1.5} />
          </button>
        ) : (
          <>
            <BrandGlyph size={26} />
            <span className="font-display text-subhead text-ink">Entole</span>
          </>
        )}
      </header>

      {onboarded ? (
        <div className="flex flex-1 flex-col justify-end pb-8">
          <h1 className="text-pretty font-display text-figure-sm text-ink">Confirm it&apos;s you</h1>
          <p className="mt-3 text-pretty font-body text-prose text-slate">
            Your session timed out. Nothing here moves until you do.
          </p>
        </div>
      ) : showNameStep ? (
        <div className="flex-1 pt-4">
          <h1 className="text-pretty font-display text-heading text-ink">
            {returning ? 'Welcome back' : 'Your details'}
          </h1>
          <p className="mt-2 text-pretty font-body text-ui text-slate">
            {returning
              ? 'Your account and your money are already here. This device just does not know your name yet.'
              : 'Your name is how Entole greets you. Your username is how people find you.'}
          </p>
          <label className="mt-7 block font-strong text-note text-slate" htmlFor="full-name">
            Full name
          </label>
          <input
            id="full-name"
            spellCheck={false}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Your full name"
            autoFocus
            autoComplete="name"
            aria-invalid={touched && nameError ? true : undefined}
            className={`mt-2 h-14 w-full rounded-control border-[1.5px] bg-card px-4 font-strong text-prose text-ink outline-none placeholder:font-body placeholder:text-mist focus:border-ink ${
              touched && nameError ? 'border-halt' : 'border-line'
            }`}
          />
          {touched && nameError ? (
            <p role="alert" className="mt-2 font-body text-note text-halt">
              {nameError}
            </p>
          ) : null}
          <label className="mt-5 block font-strong text-note text-slate" htmlFor="username">
            Username
          </label>
          <div
            className={`mt-2 flex h-14 w-full items-center rounded-control border-[1.5px] bg-card px-4 focus-within:border-ink ${
              touched && usernameError ? 'border-halt' : 'border-line'
            }`}
          >
            <span className="font-strong text-prose text-slate">@</span>
            <input
              id="username"
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={USERNAME_MAX}
              aria-invalid={touched && usernameError ? true : undefined}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onboard();
              }}
              className="ml-1 min-w-0 flex-1 bg-transparent font-strong text-prose text-ink outline-none placeholder:font-body placeholder:text-mist"
            />
          </div>
          {touched && usernameError ? (
            <p role="alert" className="mt-2 font-body text-note text-halt">
              {usernameError}
            </p>
          ) : (
            <p className="mt-2 font-body text-note text-slate">Lowercase letters, numbers, dots and underscores.</p>
          )}
        </div>
      ) : null}

      <div className="flex-none safe-bottom">
        {problem ? (
          <p role="alert" className="mb-4 text-pretty font-body text-ui text-halt">
            {problem}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || (showNameStep && !detailsValid)}
          onClick={() => void (onboarded ? signIn() : showNameStep ? onboard() : setStep('name'))}
          className="flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
        >
          {busy ? (
            <span className="flex items-center gap-2.5">
              <LogoLoader size={22} mono label="Confirming" />
              Confirming
            </span>
          ) : onboarded ? (
            'Sign in with passkey'
          ) : showNameStep && !returning ? (
            'Continue with passkey'
          ) : (
            'Continue'
          )}
        </button>

        {onboarded ? null : (
          <p className="mt-3.5 text-pretty text-center font-body text-note text-slate">
            By continuing you agree to our{' '}
            <a href="/legal/terms" target="_blank" rel="noopener" className="underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
              terms
            </a>{' '}
            and{' '}
            <a href="/legal/privacy" target="_blank" rel="noopener" className="underline decoration-mist underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
              privacy notice
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
