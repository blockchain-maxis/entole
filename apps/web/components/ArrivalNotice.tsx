'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { useAccount } from '@/lib/account';

/** How often the page re-reads the account while someone is looking at it. */
const LIVE_INTERVAL_MS = 15_000;
const VISIBLE_MS = 6000;

/**
 * Keeps a signed-in page current, and says when money arrives.
 *
 * A page used to read the account once and then wait to be reloaded, so a
 * payment someone sent showed as nothing at all until the person went looking.
 * Now the page reads again when it comes back into view and on a slow interval
 * while it is in view. When that read finds a payment that was not there
 * before, this says so once, at the top of the page: who it was from and how
 * much. The payment is already settled and already in the activity list; the
 * line links there.
 */
export function ArrivalNotice() {
  const { account } = useAccount();
  const { status, refresh, arrivals, clearArrivals, contact } = useStore();
  const reading = useRef(false);
  const signedIn = Boolean(account);
  const ready = status === 'ready';

  useEffect(() => {
    if (!signedIn || !ready) return;
    const read = () => {
      if (reading.current || document.visibilityState !== 'visible') return;
      reading.current = true;
      void refresh()
        .catch(() => undefined)
        .finally(() => {
          reading.current = false;
        });
    };
    const timer = setInterval(read, LIVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', read);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [signedIn, ready, refresh]);

  // What has arrived and not been said is the line. It stays for a few
  // seconds and is then let go, which is what makes each arrival said once.
  useEffect(() => {
    if (arrivals.length === 0) return;
    const timer = setTimeout(clearArrivals, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [arrivals, clearArrivals]);

  const [latest] = arrivals;
  if (!signedIn || !latest) return null;
  const who = contact(latest.contactId)?.name;
  const words =
    arrivals.length === 1
      ? `${who ?? 'Someone'} sent you ${formatNaira(kobo(latest.amountMinor))}`
      : `${arrivals.length} payments arrived`;

  // Placed under the header, never over it: the assistant control stays in reach.
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+76px)] z-50 flex justify-center px-gutter"
    >
      <Link
        href="/activity"
        onClick={clearArrivals}
        className="pointer-events-auto flex max-w-full items-center gap-2 rounded-pill bg-ink px-4 py-2.5 shadow-raised"
      >
        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-pill bg-settled" />
        <span className="tabular truncate font-strong text-ui text-paper">{words}</span>
      </Link>
    </div>
  );
}
