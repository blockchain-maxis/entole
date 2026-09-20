'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useBackend } from '@entole/core/backend';
import { buildCheckoutLink } from '@entole/core/checkout-link';

import { Header } from '@/components/Header';
import { QrCode } from '@/components/QrCode';
import { Skeleton } from '@/components/Skeleton';
import { useProfile } from '@/lib/profile';
import { onrampConfigured } from '@/lib/onramp';

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

type Copied = 'link' | 'code' | null;

/**
 * The far end of the corridor. Whoever pays has no app, no account and no
 * reason to get one — so everything they need is in the link: a checkout page
 * that opens in any browser, named for this account and nothing else.
 */
export default function ReceivePage() {
  const { paymentCode } = useBackend();
  const profile = useProfile();
  const origin = useOrigin();
  const canShare = useCanShare();

  const [copied, setCopied] = useState<Copied>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const link =
    origin && paymentCode
      ? buildCheckoutLink(origin, {
          code: paymentCode,
          kind: 'pay',
          ...(profile?.fullName ? { payee: profile.fullName } : {}),
        })
      : null;

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
        <div className="flex flex-col items-center rounded-panel border border-line bg-card px-gutter pb-5 pt-6">
          {link ? (
            <>
              <div className="w-full max-w-[220px] rounded-row bg-white p-2.5">
                <QrCode value={link} label="QR code for your payment link" />
              </div>
              <p className="mt-4 font-strong text-body-sm text-ink">Your payment link</p>
              <p className="mt-1 max-w-full truncate font-body text-caption text-mist">
                {link.replace(/^https?:\/\//, '')}
              </p>
            </>
          ) : (
            <div aria-label="Preparing your payment link" className="flex w-full flex-col items-center">
              <Skeleton className="h-[220px] w-[220px] rounded-row" />
              <Skeleton className="mt-4 h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
            </div>
          )}
        </div>

        <div className="mt-3.5 rounded-row border border-line bg-card px-[18px] py-4">
          <p className="font-strong text-label text-ink">They don&apos;t need the app</p>
          <p className="mt-1.5 text-pretty font-body text-label-sm text-slate">
            {bankAndCard
              ? 'Anyone can open this link and pay you from their bank or card. No account, no download, no sign-up.'
              : 'Anyone can open this link. People with the Entole app pay you in seconds. Bank and card payments for everyone else are opening soon.'}
          </p>
        </div>

        {problem ? <p className="mt-3 font-body text-label-sm text-halt">{problem}</p> : null}

        <div className="mt-4 flex gap-2.5">
          {canShare ? (
            <button
              type="button"
              disabled={!link}
              onClick={() => void share()}
              className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60"
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
                ? 'flex h-14 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-lg text-ink transition-colors hover:border-mist active:translate-y-px disabled:opacity-60'
                : 'flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60'
            }
          >
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-hairline pt-4">
          <div className="min-w-0">
            <p className="font-body text-label text-slate">Your code</p>
            {paymentCode ? (
              <p className="tabular mt-0.5 truncate font-strong text-body-sm text-ink">{paymentCode}</p>
            ) : (
              <Skeleton className="mt-1.5 h-4 w-44" />
            )}
          </div>
          <button
            type="button"
            disabled={!paymentCode}
            onClick={() => paymentCode && void copy('code', paymentCode)}
            className="flex-none font-strong text-label text-indigo transition-colors hover:text-indigo-deep disabled:opacity-60"
          >
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
        </div>
      </div>
    </main>
  );
}
