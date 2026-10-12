'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { buildPayLink } from '@entole/core/checkout-link';
import { formatNaira, kobo } from '@entole/core/money';

import { Header } from '@/components/Header';
import { PageLoader } from '@/components/LogoLoader';
import { QrCode } from '@/components/QrCode';
import { Skeleton } from '@/components/Skeleton';
import { useProfile } from '@/lib/profile';
import { onrampConfigured } from '@/lib/onramp';
import { useUsernameClaim } from '@/lib/username-claim';

const noSubscription = () => () => undefined;

/** The address of the page the person is on — the base every link is built on.
 * Empty on the server and during hydration, so the first paint is a skeleton. */
function useOrigin(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => '',
  );
}

function useCanShare(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === 'function',
    () => false,
  );
}

type Copied = 'link' | 'username' | null;

/**
 * The far end of the corridor. Whoever pays has no app, no account and no
 * reason to get one — so everything they need is in the link: a checkout page
 * that opens in any browser, named for this person and nothing else.
 *
 * The link is the person's username, short enough to say aloud, and someone
 * who has Entole needs only the username itself or the phone number. There is
 * nothing longer than that to copy, anywhere. The link exists once the
 * directory has said the username is theirs; until then the page says what it
 * is waiting for, because a link that might lead to someone else is worse than
 * no link.
 */
export default function ReceivePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Receive />
    </Suspense>
  );
}

function Receive() {
  const profile = useProfile();
  // `?amount=` (kobo) puts an amount on the link: someone asked for that much.
  const asked = useSearchParams().get('amount');
  const amountMinor = asked && /^\d{1,13}$/.test(asked) && Number(asked) > 0 ? Number(asked) : undefined;
  const origin = useOrigin();
  const canShare = useCanShare();

  const [copied, setCopied] = useState<Copied>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const claim = useUsernameClaim();
  const username = claim === 'held' ? profile?.username : undefined;
  // `/pay/@ada.eze`: the pay page looks the name up and shows who it is.
  const link =
    origin && username
      ? buildPayLink(origin, { username, ...(amountMinor ? { amountMinor, currency: 'NGN' } : {}) })
      : null;
  // Someone else holds the name they chose, or they never chose one.
  const needsUsername = Boolean(profile) && (claim === 'taken' || !profile?.username);

  async function copy(what: Exclude<Copied, null>, text: string) {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1600);
    } catch {
      setProblem("We couldn't copy that here. Press and hold the link to copy it yourself.");
    }
  }

  async function share() {
    if (!link) return;
    setProblem(null);
    try {
      await navigator.share({ title: 'Pay me with Entole', url: link });
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  const bankAndCard = onrampConfigured();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Receive" />

      <div className="flex-1 px-gutter pb-28 pt-1">
        <div className="flex flex-col items-center pb-1 pt-4">
          {link ? (
            <>
              <div className="w-full max-w-[220px] rounded-card bg-white p-2.5 shadow-raised">
                <QrCode value={link} label="QR code for your payment link" />
              </div>
              <p className="mt-5 font-display text-heading text-ink">@{username}</p>
              <p className="mt-1 max-w-full truncate font-body text-note text-slate">
                {link.replace(/^https?:\/\//, '')}
              </p>
              {amountMinor ? (
                <p className="tabular mt-3 font-strong text-ui text-ink">Asking for {formatNaira(kobo(amountMinor))}</p>
              ) : null}
            </>
          ) : needsUsername ? (
            <div className="w-full pt-2">
              <h2 className="font-display text-subhead text-ink">Choose a username to get paid</h2>
              <p className="mt-2 text-pretty font-body text-ui text-slate">
                {claim === 'taken'
                  ? 'Someone else already has the username you chose. Pick another and your link is ready straight away.'
                  : 'Your username is how people pay you, and it is what your link is made from.'}
              </p>
              <Link
                href="/me?edit=1"
                className="mt-5 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px"
              >
                Choose a username
              </Link>
            </div>
          ) : (
            <div aria-label="Preparing your payment link" className="flex w-full flex-col items-center">
              <Skeleton className="h-[220px] w-[220px] rounded-card" />
              <Skeleton className="mt-5 h-5 w-40" />
              <Skeleton className="mt-2 h-3 w-48" />
              {profile?.username ? (
                <p className="mt-4 text-pretty text-center font-body text-note text-slate">
                  Confirming @{profile.username} is yours. Your link shows here as soon as it is.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-5 border-t border-hairline pt-4">
          {username ? (
            <p className="mb-3 text-pretty font-body text-ui text-slate">
              Someone with Entole can pay you with <span className="font-strong text-ink">@{username}</span>, or with
              your phone number.
            </p>
          ) : null}
          <p className="font-strong text-ui text-ink">They don&apos;t need the app</p>
          <p className="mt-1 text-pretty font-body text-note text-slate">
            {bankAndCard
              ? 'Anyone can open this link and pay you from their bank or card. No account, no download, no sign-up.'
              : 'Anyone can open this link. People with the Entole app pay you in seconds. Bank and card payments for everyone else are opening soon.'}
          </p>
        </div>

        {problem ? <p className="mt-3 font-body text-note text-halt">{problem}</p> : null}

        <div className="mt-4 flex gap-2.5">
          {canShare ? (
            <button
              type="button"
              disabled={!link}
              onClick={() => void share()}
              className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60"
            >
              Share
            </button>
          ) : null}
          <button
            type="button"
            disabled={!link}
            onClick={() => link && void copy('link', link)}
            className={
              canShare
                ? 'flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60'
                : 'flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:opacity-60'
            }
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {username ? (
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-hairline pt-4">
            <div className="min-w-0">
              <p className="font-body text-ui text-slate">Your username</p>
              <p className="mt-0.5 truncate font-strong text-ui text-ink">@{username}</p>
            </div>
            <button
              type="button"
              onClick={() => void copy('username', `@${username}`)}
              className="flex-none font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
            >
              {copied === 'username' ? 'Copied' : 'Copy username'}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
