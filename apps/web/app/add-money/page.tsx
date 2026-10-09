'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo, subtractMinor } from '@entole/core/money';
import { RelayError, type BankTransferOffer } from '@entole/core/relay-client';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { BalanceSkeleton, Skeleton } from '@/components/Skeleton';
import { useAccount } from '@/lib/account';
import {
  REAL_MONEY,
  balanceBeforeTransfer,
  forgetBalanceBeforeTransfer,
  rememberBalanceBeforeTransfer,
} from '@/lib/add-money';

type Phase =
  /** Nothing asked yet. */
  | { kind: 'idle' }
  /** The request is on its way to the server. */
  | { kind: 'requesting' }
  /** Money is on its way; the balance is being re-read until it moves. */
  | { kind: 'waiting' }
  /** The balance moved. `addedMinor` is the real difference, read from the account. */
  | { kind: 'done'; addedMinor: number }
  /** The balance has not moved within the window. Nothing is shown as added. */
  | { kind: 'slow' }
  | { kind: 'failed'; message: string };

/** Test money lands in seconds; a bank transfer takes minutes. */
const POLL = REAL_MONEY ? { everyMs: 4000, forMs: 180_000 } : { everyMs: 1500, forMs: 20_000 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageFor(error: unknown): string {
  return error instanceof RelayError ? error.message : 'Something went wrong. Try again.';
}

const PRIMARY =
  'flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60';

/**
 * Adding money. Nothing here is optimistic: the balance only changes when a
 * fresh read of the account says it did, and until then the page says it is
 * waiting. The web twin of `apps/mobile/app/add-money.tsx`.
 *
 * On the main network the money is real and comes by bank transfer, paid on
 * the payment partner's page. Anywhere else it is test money.
 */
function AddMoney() {
  const store = useStore();
  const { relay } = useBackend();
  const { account } = useAccount();
  const returned = useSearchParams().get('returned') === '1';

  // Back from the partner's page: wait on the balance from before leaving.
  const [before] = useState<number | null>(() => (returned ? balanceBeforeTransfer() : null));
  const [phase, setPhase] = useState<Phase>(before === null ? { kind: 'idle' } : { kind: 'waiting' });
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [reviewing, setReviewing] = useState(false);
  const startBalance = useRef<number>(before ?? store.balance);
  const { refresh } = store;

  const ready = store.status === 'ready';
  const waiting = phase.kind === 'waiting';
  const amount = entryToMinor(entry);

  // Re-read the account until the balance goes up, or the window closes.
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const deadline = Date.now() + POLL.forMs;
    void (async () => {
      while (live && Date.now() < deadline) {
        try {
          await refresh();
        } catch {
          // A read that fails shows nothing new; the next one may work.
        }
        if (!live) return;
        await sleep(POLL.everyMs);
      }
      if (live) setPhase((current) => (current.kind === 'waiting' ? { kind: 'slow' } : current));
    })();
    return () => {
      live = false;
    };
  }, [waiting, refresh]);

  // The balance moving is the only thing that completes this.
  useEffect(() => {
    if (!waiting || !ready || store.balance <= startBalance.current) return;
    forgetBalanceBeforeTransfer();
    setPhase({ kind: 'done', addedMinor: subtractMinor(store.balance, kobo(startBalance.current)) });
  }, [waiting, ready, store.balance]);

  async function addTestMoney() {
    if (!owner) return;
    startBalance.current = store.balance;
    setPhase({ kind: 'requesting' });
    try {
      await relay.requestFunds(owner);
      setPhase({ kind: 'waiting' });
    } catch (error) {
      setPhase({ kind: 'failed', message: messageFor(error) });
    }
  }

  const owner = account?.owner.viemAccount.address;
  const startTransfer = useCallback(
    () => (owner ? relay.startBankTransfer(owner, amount) : Promise.reject(new RelayError('unreachable'))),
    [relay, owner, amount],
  );
  const leaveForPartner = useCallback(() => rememberBalanceBeforeTransfer(store.balance), [store.balance]);
  const closeReview = useCallback(() => setReviewing(false), []);

  const busy = phase.kind === 'requesting' || waiting;
  const entering = REAL_MONEY && phase.kind === 'idle';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Add money" back="/" />

      <div className="flex-1 px-gutter">
        {ready ? (
          <section className="rounded-panel bg-card p-6 shadow-raised">
            <p className="font-strong text-label-sm text-mist">Your balance</p>
            <div className="mt-2.5">
              <Amount value={store.balance} size="large" />
            </div>
            <p className="tabular mt-3 font-body text-body-sm text-slate">
              ≈ {formatDollars(toDollars(store.balance, store.rate))}
            </p>
          </section>
        ) : store.status === 'failed' ? (
          <div className="rounded-row border border-line bg-card px-4 py-4">
            <p className="font-strong text-body-sm text-ink">We couldn&apos;t load your account.</p>
            <button
              type="button"
              onClick={() => void refresh().catch(() => undefined)}
              className="mt-1 font-strong text-label-sm text-indigo hover:text-indigo-deep"
            >
              Try again
            </button>
          </div>
        ) : (
          <BalanceSkeleton />
        )}

        {entering ? (
          <div className="mt-7 flex flex-col items-center">
            <p className="font-strong text-label-sm text-slate">How much are you adding?</p>
            <div className="mt-3">
              <Amount value={kobo(amount)} size="large" />
            </div>
            <p className="mt-2.5 font-body text-body-sm text-slate">
              {amount > 0 ? 'Paid by bank transfer' : 'Enter an amount'}
            </p>
          </div>
        ) : null}

        {!REAL_MONEY && phase.kind === 'idle' ? (
          <p className="mt-6 px-1 font-body text-body-sm text-slate">
            Add test money to try Entole. It&apos;s not real money.
          </p>
        ) : null}

        <div className="mt-5" aria-live="polite">
          {busy ? (
            <div className="rounded-row border border-line bg-card px-4 py-4">
              <p className="font-strong text-body-sm text-ink">
                {phase.kind === 'requesting'
                  ? 'Adding money'
                  : REAL_MONEY
                    ? 'Waiting for your money to arrive'
                    : 'Waiting for your balance to update'}
              </p>
              <p className="mt-1 font-body text-label-sm text-slate">
                {phase.kind === 'requesting'
                  ? 'Sending your request.'
                  : REAL_MONEY
                    ? 'A bank transfer can take a few minutes. Your balance only changes once it has arrived.'
                    : 'It usually takes a few seconds. Your balance only changes once it has arrived.'}
              </p>
              <Skeleton className="mt-3.5 h-2 w-full rounded-pill" />
            </div>
          ) : null}

          {phase.kind === 'done' ? (
            <div className="rounded-row border border-line bg-settled-wash px-4 py-4">
              <p className="tabular font-strong text-body text-settled">{formatNaira(kobo(phase.addedMinor))} added</p>
              <p className="mt-1 font-body text-label-sm text-slate">It&apos;s in your balance now.</p>
            </div>
          ) : null}

          {phase.kind === 'slow' ? (
            <div className="rounded-row border border-line bg-card px-4 py-4">
              <p className="font-strong text-body-sm text-ink">Still on its way</p>
              <p className="mt-1 font-body text-label-sm text-slate">
                {REAL_MONEY
                  ? "The money hasn't shown up yet. Bank transfers are sometimes slow. Check again in a few minutes."
                  : "Your request went through, but the money hasn't shown up yet. Check again in a moment."}
              </p>
            </div>
          ) : null}

          {phase.kind === 'failed' ? (
            <div role="alert" className="rounded-row border border-line bg-halt-wash px-4 py-4">
              <p className="font-strong text-body-sm text-halt">{phase.message}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="w-full px-gutter pb-28 pt-4">
        {entering ? <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} /> : null}
        <div className="mt-3 flex">
          {phase.kind === 'done' ? (
            <Link href="/" className={PRIMARY}>
              Done
            </Link>
          ) : phase.kind === 'slow' ? (
            <button type="button" onClick={() => setPhase({ kind: 'waiting' })} className={PRIMARY}>
              Check again
            </button>
          ) : busy ? (
            <button type="button" disabled className={PRIMARY}>
              Adding money
            </button>
          ) : REAL_MONEY ? (
            <button
              type="button"
              disabled={!ready || !account || amount <= 0}
              onClick={() => setReviewing(true)}
              className={PRIMARY}
            >
              Review
            </button>
          ) : (
            <button
              type="button"
              disabled={!ready || !account}
              onClick={() => void addTestMoney()}
              className={PRIMARY}
            >
              Add test money
            </button>
          )}
        </div>
      </div>

      {reviewing ? (
        <BankTransferSheet amountMinor={amount} start={startTransfer} onLeave={leaveForPartner} onDismiss={closeReview} />
      ) : null}
    </main>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <dt className={`font-body text-label ${strong ? 'text-ink' : 'text-slate'}`}>{label}</dt>
      <dd className={`tabular text-label text-ink ${strong ? 'font-heavy' : 'font-strong'}`}>{value}</dd>
    </div>
  );
}

type Offer = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; offer: BankTransferOffer };

/**
 * The last look before leaving for the payment partner's page: what the person
 * pays, what it costs, and about what arrives. Every figure comes from the
 * server's answer; nothing is priced here. The link is opened, never shown.
 */
function BankTransferSheet({
  amountMinor,
  start,
  onLeave,
  onDismiss,
}: {
  amountMinor: number;
  start: () => Promise<BankTransferOffer>;
  onLeave: () => void;
  onDismiss: () => void;
}) {
  const [offer, setOffer] = useState<Offer>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  // Asked once when the sheet opens, and again only on "Try again".
  useEffect(() => {
    let live = true;
    start()
      .then((next) => {
        if (live) setOffer({ state: 'ready', offer: next });
      })
      .catch((error: unknown) => {
        if (live) setOffer({ state: 'failed', message: messageFor(error) });
      });
    return () => {
      live = false;
    };
  }, [start, attempt]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const ready = offer.state === 'ready' ? offer.offer : null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={onDismiss} className="absolute inset-0 bg-scrim" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-money-title"
        tabIndex={-1}
        className="relative max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-sheet bg-card px-gutter-lg pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-floating outline-none"
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-pill bg-line" />

        <h2 id="add-money-title" className="mt-4 font-strong text-title text-ink">
          Add by bank transfer
        </h2>

        {ready ? (
          <div className="mt-5">
            <p className="font-body text-caption text-slate">About this much arrives</p>
            <p className="tabular mt-0.5 font-strong text-title-xl text-ink">{formatNaira(kobo(ready.arrivesMinor))}</p>

            <dl className="mt-3 border-t border-hairline">
              <Line label="You pay" value={formatNaira(kobo(ready.payMinor))} strong />
              <div className="border-t border-hairline">
                <Line label="Fee" value={formatNaira(kobo(ready.feeMinor))} />
              </div>
            </dl>

            <p className="mt-3 text-pretty font-body text-label-sm text-slate">
              You pay on our payment partner&apos;s page. The first time, they ask for your phone number and ID. Your
              balance changes once the money has arrived.
            </p>
          </div>
        ) : offer.state === 'loading' ? (
          <div className="mt-5" aria-label="Working out the fee">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="mt-2.5 h-8 w-44" />
            <div className="mt-6 flex flex-col gap-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ) : offer.state === 'failed' ? (
          <p role="alert" className="mt-5 font-body text-label text-halt">
            {offer.message}
          </p>
        ) : null}

        <div className="mt-5 flex">
          {offer.state === 'failed' ? (
            <button
              type="button"
              onClick={() => {
                setOffer({ state: 'loading' });
                setAttempt((count) => count + 1);
              }}
              className={PRIMARY}
            >
              Try again
            </button>
          ) : ready ? (
            <a href={ready.url} rel="noopener noreferrer" onClick={onLeave} className={PRIMARY}>
              Continue
            </a>
          ) : (
            <button type="button" disabled className={PRIMARY}>
              {`Add ${formatNaira(kobo(amountMinor))}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AddMoneyPage() {
  return (
    <Suspense fallback={null}>
      <AddMoney />
    </Suspense>
  );
}
