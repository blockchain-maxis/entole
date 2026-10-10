'use client';

import { ChevronRight, CreditCard, Landmark, ScanLine, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_ENTRY, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { useBackend } from '@entole/core/backend';
import { DEPOSIT_SOURCES, depositSourceLabel, type DepositSource } from '@entole/core/deposit-sources';
import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo, subtractMinor } from '@entole/core/money';
import { RelayError, type BankTransferOffer } from '@entole/core/relay-client';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';
import { QrCode } from '@/components/QrCode';
import { BalanceSkeleton, Skeleton } from '@/components/Skeleton';
import { useAccount } from '@/lib/account';
import {
  BANK_TRANSFER,
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

/** How real money comes in. Test money has no choice to make. */
type Way = 'choose' | 'another-app' | 'card' | 'bank';

type Loaded<T> = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; value: T };

/** Test money lands in seconds; real money can take minutes to be sent at all. */
const POLL = REAL_MONEY ? { everyMs: 5000, forMs: 600_000 } : { everyMs: 1500, forMs: 20_000 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageFor(error: unknown): string {
  return error instanceof RelayError ? error.message : 'Something went wrong. Try again.';
}

const PRIMARY =
  'flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60';
const SECONDARY =
  'flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card font-strong text-body-lg text-ink transition-colors hover:border-mist active:translate-y-px';

/**
 * Adding money. Nothing here is optimistic: the balance only changes when a
 * fresh read of the account says it did, and until then the page says it is
 * waiting. The web twin of `apps/mobile/app/add-money.tsx`.
 *
 * On the main network the money is real. It comes from an app the person
 * already holds dollars in, by card, or (once our partner id exists) by bank
 * transfer in naira. Anywhere else it is test money.
 */
function AddMoney() {
  const store = useStore();
  const { relay } = useBackend();
  const { account } = useAccount();
  const returned = useSearchParams().get('returned') === '1';

  // Back from a partner's page: wait on the balance from before leaving.
  const [before] = useState<number | null>(() => (returned ? balanceBeforeTransfer() : null));
  const [phase, setPhase] = useState<Phase>(before === null ? { kind: 'idle' } : { kind: 'waiting' });
  const [way, setWay] = useState<Way>('choose');
  const [source, setSource] = useState<DepositSource | null>(null);
  const [code, setCode] = useState<Loaded<string> | null>(null);
  const [card, setCard] = useState<Loaded<string> | null>(null);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [reviewing, setReviewing] = useState(false);
  const startBalance = useRef<number>(before ?? store.balance);
  const { refresh } = store;

  const owner = account?.owner.viemAccount.address;
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

  /** From here the balance is all that counts. */
  function startWaiting() {
    startBalance.current = store.balance;
    setPhase({ kind: 'waiting' });
  }

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

  async function pickSource(next: DepositSource) {
    if (!owner) return;
    setSource(next);
    setCode({ state: 'loading' });
    try {
      const { qrPayload } = await relay.startDeposit(owner, next.id);
      setCode({ state: 'ready', value: qrPayload });
      startWaiting();
    } catch (error) {
      setCode({ state: 'failed', message: messageFor(error) });
    }
  }

  async function openCard() {
    if (!owner) return;
    setWay('card');
    setCard({ state: 'loading' });
    try {
      const { url } = await relay.startCardPayment(owner);
      setCard({ state: 'ready', value: url });
    } catch (error) {
      setCard({ state: 'failed', message: messageFor(error) });
    }
  }

  function backToWays() {
    setWay('choose');
    setSource(null);
    setCode(null);
    setCard(null);
    setPhase({ kind: 'idle' });
  }

  const startTransfer = useCallback(
    () => (owner ? relay.startBankTransfer(owner, amount) : Promise.reject(new RelayError('unreachable'))),
    [relay, owner, amount],
  );
  const leaveForPartner = useCallback(() => rememberBalanceBeforeTransfer(store.balance), [store.balance]);
  const closeReview = useCallback(() => setReviewing(false), []);

  const busy = phase.kind === 'requesting' || waiting;
  const settled = phase.kind === 'done' || phase.kind === 'slow';
  // Back from a partner page there is no choice left to make, only the wait.
  const choosing = REAL_MONEY && way === 'choose' && phase.kind === 'idle';
  const enteringBank = REAL_MONEY && way === 'bank' && phase.kind === 'idle';
  const showingCode = way === 'another-app' && code?.state === 'ready';

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

        {choosing ? (
          <WaysToAdd
            disabled={!ready || !owner}
            onAnotherApp={() => setWay('another-app')}
            onCard={() => void openCard()}
            onBank={() => setWay('bank')}
          />
        ) : null}

        {REAL_MONEY && way === 'another-app' && !settled ? (
          <FromAnotherApp source={source} code={code} onPick={(next) => void pickSource(next)} />
        ) : null}

        {REAL_MONEY && way === 'card' && phase.kind === 'idle' ? <CardStep card={card} /> : null}

        {enteringBank ? (
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
                  : showingCode
                    ? 'This page updates by itself once you have sent it. Your balance only changes when it has arrived.'
                    : REAL_MONEY
                      ? 'It can take a few minutes. Your balance only changes once it has arrived.'
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
              <p className="font-strong text-body-sm text-ink">
                {REAL_MONEY ? 'Nothing has arrived yet' : 'Still on its way'}
              </p>
              <p className="mt-1 font-body text-label-sm text-slate">
                {REAL_MONEY
                  ? "If you have sent it, it is on its way. Check again in a few minutes. If you haven't, nothing was taken."
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
        {enteringBank ? <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} /> : null}
        <div className="mt-3 flex gap-2.5">
          {phase.kind === 'done' ? (
            <Link href="/" className={PRIMARY}>
              Done
            </Link>
          ) : phase.kind === 'slow' ? (
            <button type="button" onClick={() => setPhase({ kind: 'waiting' })} className={PRIMARY}>
              Check again
            </button>
          ) : !REAL_MONEY ? (
            busy ? (
              <button type="button" disabled className={PRIMARY}>
                Adding money
              </button>
            ) : (
              <button type="button" disabled={!ready || !owner} onClick={() => void addTestMoney()} className={PRIMARY}>
                Add test money
              </button>
            )
          ) : choosing ? null : way === 'card' && card?.state === 'ready' && phase.kind === 'idle' ? (
            <>
              <button type="button" onClick={backToWays} className={SECONDARY}>
                Back
              </button>
              <a
                href={card.value}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  leaveForPartner();
                  startWaiting();
                }}
                className={PRIMARY}
              >
                Continue
              </a>
            </>
          ) : enteringBank ? (
            <>
              <button type="button" onClick={backToWays} className={SECONDARY}>
                Back
              </button>
              <button
                type="button"
                disabled={!ready || !owner || amount <= 0}
                onClick={() => setReviewing(true)}
                className={PRIMARY}
              >
                Review
              </button>
            </>
          ) : (
            <button type="button" onClick={backToWays} className={SECONDARY}>
              {waiting ? 'Add another way' : 'Back'}
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

function WayRow({
  icon: Icon,
  title,
  hint,
  onPick,
  disabled = false,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onPick?: () => void;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled || !onPick}
        onClick={onPick}
        className="flex w-full items-center gap-3.5 rounded-row border border-line bg-card px-4 py-3.5 text-left transition-colors hover:border-mist active:translate-y-px disabled:opacity-60 disabled:hover:border-line"
      >
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-indigo-wash text-indigo">
          <Icon size={20} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-strong text-body text-ink">{title}</span>
          <span className="mt-0.5 block font-body text-label-sm text-slate">{hint}</span>
        </span>
        {onPick ? <ChevronRight size={18} strokeWidth={1.5} className="flex-none text-mist" aria-hidden /> : null}
      </button>
    </li>
  );
}

/** The three ways real money comes in. One is not open yet, and says so. */
function WaysToAdd({
  disabled,
  onAnotherApp,
  onCard,
  onBank,
}: {
  disabled: boolean;
  onAnotherApp: () => void;
  onCard: () => void;
  onBank: () => void;
}) {
  return (
    <>
      <p className="pb-3 pt-7 font-strong text-body-lg text-ink">How do you want to add money?</p>
      <ul className="flex flex-col gap-2.5">
        <WayRow
          icon={ScanLine}
          title="From another app"
          hint="Send dollars you already hold somewhere else."
          onPick={onAnotherApp}
          disabled={disabled}
        />
        <WayRow icon={CreditCard} title="Card" hint="Debit or credit card. $20 or more." onPick={onCard} disabled={disabled} />
        {BANK_TRANSFER ? (
          <WayRow icon={Landmark} title="Bank transfer" hint="Pay in naira from your bank." onPick={onBank} disabled={disabled} />
        ) : (
          <WayRow icon={Landmark} title="Bank transfer" hint="In naira. Coming soon." />
        )}
      </ul>
    </>
  );
}

/**
 * Money from an app the person already uses. They say what they are sending
 * and get a code to send it to. The code is an address, so it is only ever a
 * picture to scan or something to copy: it is never written out.
 */
function FromAnotherApp({
  source,
  code,
  onPick,
}: {
  source: DepositSource | null;
  code: Loaded<string> | null;
  onPick: (source: DepositSource) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (!source || code?.state === 'failed') {
    return (
      <>
        <p className="pb-1 pt-7 font-strong text-body-lg text-ink">What are you sending?</p>
        <p className="pb-3 font-body text-label-sm text-slate">
          Pick what you hold in the other app. It arrives here as dollars in your balance.
        </p>
        {code?.state === 'failed' ? (
          <p role="alert" className="pb-3 font-body text-label-sm text-halt">
            {code.message}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {DEPOSIT_SOURCES.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => onPick(option)}
                className="flex w-full items-center justify-between rounded-row border border-line bg-card px-4 py-3.5 text-left transition-colors hover:border-mist active:translate-y-px"
              >
                <span className="font-strong text-body text-ink">{depositSourceLabel(option)}</span>
                <ChevronRight size={18} strokeWidth={1.5} className="text-mist" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const label = depositSourceLabel(source);

  return (
    <div className="pt-7">
      <p className="font-strong text-body-lg text-ink">Send {label} to this code</p>
      <p className="mt-1 text-pretty font-body text-label-sm text-slate">
        Scan it from the app you are sending from, or copy it and paste it there. Send $1 or more.
      </p>

      <div className="mx-auto mt-5 w-full max-w-[240px]">
        {code?.state === 'ready' ? (
          <QrCode value={code.value} label={`Code to send ${label} to`} />
        ) : (
          <Skeleton className="aspect-square w-full rounded-control" />
        )}
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          disabled={code?.state !== 'ready'}
          onClick={() => code?.state === 'ready' && void copy(code.value)}
          className="rounded-pill border border-line bg-card px-5 py-2.5 font-strong text-label text-indigo transition-colors hover:border-mist active:translate-y-px disabled:opacity-60"
        >
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>

      <p className="mt-4 text-pretty font-body text-caption text-slate">
        Only send {label} to it. Something else sent here may not arrive and may not be returned.
      </p>
    </div>
  );
}

/** Card, paid on the partner's page. Nothing is priced here, so nothing is quoted. */
function CardStep({ card }: { card: Loaded<string> | null }) {
  return (
    <div className="pt-7">
      <p className="font-strong text-body-lg text-ink">Pay by card</p>
      {card?.state === 'failed' ? (
        <p role="alert" className="mt-2 font-body text-label-sm text-halt">
          {card.message}
        </p>
      ) : card?.state === 'ready' ? (
        <>
          <p className="mt-1 text-pretty font-body text-label-sm text-slate">
            You pay on our card partner&apos;s page, which opens next. It shows the amount, their fee and what you
            get before you pay. $20 or more.
          </p>
          <p className="mt-3 text-pretty font-body text-label-sm text-slate">
            Come back here afterwards. Your balance changes once the money has arrived.
          </p>
        </>
      ) : (
        <div aria-label="Getting the card page ready">
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2.5 h-4 w-3/4" />
        </div>
      )}
    </div>
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
