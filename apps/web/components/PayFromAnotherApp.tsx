'use client';

import { Check, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  PAY_IN_SOURCES,
  formatPocketAmount,
  payInSourceLabel,
  type MovementState,
  type PayInSource,
} from '@entole/core/intents-pockets';
import { MOVEMENT_FOR_PAYER } from '@entole/core/invoice-pay';
import { createInvoicePayClient } from '@entole/core/near-client';

import { LogoLoader } from './LogoLoader';
import { ScanCode } from './ScanCode';
import { FINAL_STATES, useMovementState } from '@/lib/movement';
import { messageOf } from '@/lib/pockets';

/**
 * Paying an invoice from an app the payer already uses: they pick what they
 * hold, get a one-time code good for exactly the invoice's value, and watch
 * it arrive. The code is drawn as a scan code with a copy button and never as
 * text (founder's decision, 12 November, the same rule as Add money). The
 * invoice is marked paid on the business's side only once the money has
 * arrived; this page says only what the payment itself has done.
 */

type Quote = { qrPayload: string; sendCents: number; invoiceCents: number; deadline: string | null };

/**
 * Why the payer is asked for more than the invoice says. Worked out from the
 * quote itself, never written in: in dollars it is the exact difference; from
 * another currency the two figures cannot be subtracted, so it says what the
 * difference is for without a number.
 */
function feeWords(quote: Quote, source: PayInSource): string {
  if (source.currency !== 'USD') return 'What you send includes the exchange and network fees.';
  const extra = quote.sendCents - quote.invoiceCents;
  if (extra <= 0) return '';
  return `That includes ${formatPocketAmount(extra, 'USD')} for the exchange and network fees.`;
}

const ROW =
  'flex min-h-14 w-full items-center gap-3 border-b border-hairline py-3.5 text-left transition-colors hover:bg-press active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';

export function PayFromAnotherApp({
  username,
  reference,
  amountMinor,
  className,
}: {
  username: string;
  reference: string;
  amountMinor: number;
  className: string;
}) {
  const client = useMemo(() => createInvoicePayClient({ baseUrl: '' }), []);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<PayInSource | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const state: MovementState = useMovementState(client.state, quote?.qrPayload ?? null);

  async function pick(next: PayInSource) {
    setSource(next);
    setProblem(null);
    setQuote(null);
    try {
      setQuote(await client.quote({ username, reference, amountMinor, source: next.id }));
    } catch (error) {
      setProblem(messageOf(error));
      setSource(null);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Pay from another app
      </button>
    );
  }

  return (
    <section aria-labelledby="another-app" className="border-y border-hairline py-4">
      <h3 id="another-app" className="font-strong text-prose text-ink">
        Pay from another app
      </h3>

      {!quote ? (
        <>
          <p className="mt-1 pb-3 text-pretty font-body text-note text-slate">
            Pick what you hold, the way your app names it. You will get a code for exactly what this invoice is worth.
          </p>
          {problem ? (
            <p role="alert" className="pb-3 text-pretty font-body text-note text-halt">
              {problem}
            </p>
          ) : null}
          <ul className="border-t border-hairline">
            {PAY_IN_SOURCES.map((each) => (
              <li key={each.id}>
                <button type="button" disabled={source !== null} onClick={() => void pick(each)} className={ROW}>
                  <span className="flex-1 font-strong text-ui text-ink">{payInSourceLabel(each)}</span>
                  {source?.id === each.id ? (
                    <LogoLoader size={20} label="Getting the code" mono />
                  ) : (
                    <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="text-mist" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="pt-2">
          <p className="font-strong text-prose text-ink">
            Send {formatPocketAmount(quote.sendCents, source!.currency)} of {payInSourceLabel(source!)}
          </p>
          <p className="mt-1 text-pretty font-body text-note text-slate">
            Scan it from the app you are paying from, or copy it and paste it there. It pays this invoice in full,{' '}
            {formatPocketAmount(quote.invoiceCents, 'USD')} at today&apos;s rate.{' '}
            {feeWords(quote, source!)}
            {quote.deadline
              ? ` The code is good until ${new Date(quote.deadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
              : ''}
          </p>
          <div className="mt-5">
            <ScanCode value={quote.qrPayload} label={`Code to send ${payInSourceLabel(source!)} to`} />
          </div>
          <p role="status" className="mt-5 flex items-center justify-center gap-2 text-center font-strong text-ui text-ink">
            {state === 'done' ? (
              <Check size={18} strokeWidth={2} aria-hidden className="flex-none text-settled" />
            ) : FINAL_STATES.includes(state) ? (
              <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[2px] bg-halt" />
            ) : (
              <span aria-hidden className="h-2.5 w-2.5 flex-none animate-pulse rounded-pill bg-caution" />
            )}
            {MOVEMENT_FOR_PAYER[state]}
          </p>
          {state === 'waiting' ? (
            <button
              type="button"
              onClick={() => {
                setQuote(null);
                setSource(null);
              }}
              className="mx-auto mt-3 block min-h-11 font-strong text-ui text-slate underline decoration-mist underline-offset-4 hover:text-ink"
            >
              Pay from something else
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
