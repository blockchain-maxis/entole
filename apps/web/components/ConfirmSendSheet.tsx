'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SendQuote } from '@entole/core/gateway';
import { cents, formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { plainMessage, rateLine } from '@/lib/send';

import { Skeleton } from './Skeleton';

type Quote = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; quote: SendQuote };

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <dt className={`font-body text-label ${strong ? 'text-ink' : 'text-slate'}`}>{label}</dt>
      <dd className={`tabular text-label text-ink ${strong ? 'font-heavy' : 'font-strong'}`}>{value}</dd>
    </div>
  );
}

/**
 * The last look before money leaves — the web twin of the phone's
 * `ConfirmSendSheet`, same states and same words. Everything on it comes from
 * `store.quoteSend`: the fee is whatever the payment will really cost, never a
 * number this panel carries. Nothing is shown as sent until the payment has
 * settled: `store.send` resolves only then, and only then does this hand over
 * to the receipt.
 *
 * States: `loading` (skeleton while the quote is fetched), `failed` (the quote's
 * own message, with a retry), `ready`, `not enough` (the total with the fee does
 * not fit the balance — no send is offered), `sending` (locked, waiting for the
 * payment to settle), and a send failure (the message inline, with a retry).
 */
export function ConfirmSendSheet({
  contactId,
  name,
  caption,
  initials,
  amountMinor,
  defaultNote,
  onDismiss,
  onSettled,
}: {
  contactId: string;
  name: string;
  caption?: string;
  initials: string;
  amountMinor: number;
  /** Pre-fills the note — an invoice payment names its reference. */
  defaultNote?: string;
  onDismiss: () => void;
  onSettled: (receiptId: string) => void;
}) {
  const store = useStore();
  const { quoteSend } = store;

  const [quote, setQuote] = useState<Quote>({ state: 'loading' });
  const [note, setNote] = useState(defaultNote ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(defaultNote));
  const [sending, setSending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const requestId = useRef(0);
  const panel = useRef<HTMLDivElement>(null);

  // Only the answer sets state, so the first request can run from an effect
  // while the panel is already showing its skeleton.
  const fetchQuote = useCallback(() => {
    const id = (requestId.current += 1);
    quoteSend(amountMinor).then(
      (next) => {
        if (id === requestId.current) setQuote({ state: 'ready', quote: next });
      },
      (error: unknown) => {
        if (id === requestId.current) {
          setQuote({
            state: 'failed',
            message: plainMessage(error, "We couldn't work out the fee for this payment. Try again."),
          });
        }
      },
    );
  }, [amountMinor, quoteSend]);

  useEffect(() => {
    fetchQuote();
    return () => {
      // A quote that arrives after the panel is gone is dropped.
      requestId.current += 1;
    };
  }, [fetchQuote]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !sending) onDismiss();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss, sending]);

  function retry() {
    setQuote({ state: 'loading' });
    fetchQuote();
  }

  const ready = quote.state === 'ready' ? quote.quote : null;
  // Not while sending: the moment a payment settles the balance drops, and that
  // must not read as "not enough" on the way to the receipt.
  const short = ready && !sending ? ready.totalMinor > store.balance : false;

  async function confirm() {
    if (!ready || short || sending) return;
    setProblem(null);
    setSending(true);
    try {
      const trimmed = note.trim();
      // One passkey prompt happens inside this. It resolves only once the
      // payment has settled — there is no interim success.
      const receipt = await store.send({
        contactId,
        amountMinor,
        ...(trimmed ? { note: trimmed } : {}),
      });
      setSettled(true);
      onSettled(receipt.id);
    } catch (error) {
      setSending(false);
      setProblem(plainMessage(error, "That payment didn't go through. Nothing was taken."));
      // If it did go through after all, the balance says so.
      void store.refresh().catch(() => undefined);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        disabled={sending}
        onClick={onDismiss}
        className="absolute inset-0 bg-scrim"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        tabIndex={-1}
        className="relative max-h-[86dvh] w-full max-w-[560px] overflow-y-auto rounded-t-sheet bg-card px-gutter-lg pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-floating outline-none"
      >
        <div aria-hidden className="mx-auto h-1 w-10 rounded-pill bg-line" />

        <h2 id="review-title" className="mt-4 font-strong text-title text-ink">
          Review payment
        </h2>

        <div className="mt-4 flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-avatar-1 font-strong text-label text-paper"
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-strong text-body text-ink">{name}</p>
            {caption ? <p className="font-body text-caption text-slate">{caption}</p> : null}
          </div>
        </div>

        {ready ? (
          <div className="mt-5">
            <p className="font-body text-caption text-slate">They receive</p>
            <p className="tabular mt-0.5 font-strong text-title-xl text-ink">
              {formatDollars(cents(Math.floor(ready.receivesCents)))}
            </p>
            <p className="tabular mt-0.5 font-body text-caption text-slate">{rateLine(ready.rate)}</p>

            <dl className="mt-3 border-t border-hairline">
              <Line label="Amount" value={formatNaira(kobo(ready.amountMinor))} />
              <Line label="Fee" value={formatNaira(kobo(ready.feeMinor))} />
              <div className="border-t border-hairline">
                <Line strong label="Total from you" value={formatNaira(kobo(ready.totalMinor))} />
              </div>
            </dl>
          </div>
        ) : quote.state === 'loading' ? (
          <div className="mt-5" aria-label="Working out the fee">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-8 w-44" />
            <Skeleton className="mt-2.5 h-3 w-28" />
            <div className="mt-6 flex flex-col gap-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ) : null}

        {quote.state === 'failed' ? (
          <p className="mt-5 font-body text-label text-halt">{quote.message}</p>
        ) : null}

        {ready && short ? (
          <p className="mt-3 font-body text-label text-caution">
            You don&apos;t have enough for this payment and its fee. You have {formatNaira(store.balance)}.
          </p>
        ) : null}

        {ready && !short ? (
          <div className="mt-4">
            {noteOpen ? (
              <label className="block">
                <span className="font-strong text-caption text-slate">
                  What&apos;s it for? <span className="font-body text-mist">Optional</span>
                </span>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="A few words, if you like"
                  maxLength={80}
                  disabled={sending}
                  className="mt-2 h-12 w-full rounded-control border border-line bg-paper px-3.5 font-body text-body-sm text-ink outline-none focus:border-indigo"
                />
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="font-strong text-label text-indigo hover:text-indigo-deep"
              >
                Add a note
              </button>
            )}
          </div>
        ) : null}

        {problem ? <p className="mt-4 font-body text-label text-halt">{problem}</p> : null}
        {sending && !settled ? (
          <p className="mt-4 font-body text-label text-slate">
            Sending. This updates when the payment has settled.
          </p>
        ) : null}

        <div className="mt-5 flex">
          {quote.state === 'failed' ? (
            <button
              type="button"
              onClick={retry}
              className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep"
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              disabled={!ready || short || settled || sending}
              onClick={() => void confirm()}
              className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep active:translate-y-px disabled:opacity-60"
            >
              {settled ? 'Settled' : sending ? 'Sending' : problem ? 'Try again' : 'Confirm and send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
