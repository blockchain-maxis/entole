import { ArrowUpRight, Clock } from 'lucide-react';
import Link from 'next/link';

import type { Checkout } from '@entole/core/checkout-link';
import { kobo } from '@entole/core/money';
import { initialsFor } from '@entole/core/profile';

import {
  appLinkFor,
  browserSendPathFor,
  codeLabel,
  dueState,
  formatCheckoutAmount,
  payeeName,
} from '@/lib/checkout';

import { Figure } from './Amount';
import { Avatar } from './Avatar';

/**
 * The two faces of a checkout link. Both are plain server-rendered markup:
 * the page has to work for someone with no account, no app and no script
 * budget, on whatever phone opened the link.
 */

/** The amount, as the figure this page is about. Naira gets the shared
 * `Figure`; another currency is a plain line in the same face, because the app
 * only draws naira. */
function CheckoutAmount({ checkout }: { checkout: Checkout }) {
  if (checkout.amountMinor === undefined) return null;
  const currency = checkout.currency ?? 'NGN';
  if (currency === 'NGN') return <Figure value={kobo(checkout.amountMinor)} />;
  return (
    <p className="tabular font-display text-figure-md text-ink">
      {formatCheckoutAmount(checkout.amountMinor, currency)}
    </p>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 text-pretty font-body text-note text-slate">{children}</p>;
}

/** What the link's author wrote is theirs, not ours — the page says so. */
const AUTHORED_BY_SENDER =
  'The name and note on this page were written by whoever made the link. Only pay someone you know.';

// ---------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------

export function PayDetails({ checkout }: { checkout: Checkout }) {
  const who = payeeName(checkout);

  return (
    <section aria-labelledby="checkout-title" className="pt-8">
      <div className="flex items-center gap-3">
        <Avatar initials={checkout.payee ? initialsFor(checkout.payee) : 'E'} tone={2} />
        <p className="font-body text-note text-slate">Payment request</p>
      </div>

      <h1 id="checkout-title" className="mt-4 text-pretty break-words font-display text-heading text-ink">
        Pay {who}
      </h1>

      {checkout.amountMinor !== undefined ? (
        <div className="mt-5">
          <CheckoutAmount checkout={checkout} />
        </div>
      ) : (
        <div className="mt-6 border-y border-hairline py-4">
          <p className="font-strong text-ui text-ink">You choose the amount</p>
          <p className="mt-0.5 text-pretty font-body text-note text-slate">
            No amount was set on this link. You will enter how much to send in the next step.
          </p>
        </div>
      )}

      {checkout.note ? (
        <div className="mt-6 border-t border-hairline pt-4">
          <p className="font-body text-note text-slate">For</p>
          <p className="mt-1 text-pretty break-words font-body text-prose text-ink">{checkout.note}</p>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

function DueBadge({ label, overdue }: { label: string; overdue: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-strong text-note ${
        overdue ? 'bg-halt-wash text-halt' : 'bg-press text-slate'
      }`}
    >
      <Clock size={13} strokeWidth={1.75} aria-hidden />
      {label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="flex-none font-body text-ui text-slate">{label}</dt>
      <dd className="min-w-0 break-words text-right font-strong text-ui text-ink">{children}</dd>
    </div>
  );
}

export function InvoiceDetails({ checkout, now }: { checkout: Checkout; now: Date }) {
  const due = dueState(checkout.dueAt, now);
  const who = checkout.payee ?? 'them';

  return (
    <article aria-labelledby="checkout-title" className="mt-8 overflow-hidden rounded-card bg-card shadow-raised">
      <div className="px-5 pb-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <p className="font-body text-note text-slate">Invoice</p>
          {due ? <DueBadge label={due.label} overdue={due.overdue} /> : null}
        </div>

        <h1 id="checkout-title" className="mt-3 text-pretty break-words font-display text-heading text-ink">
          {checkout.reference ? `Invoice ${checkout.reference}` : 'Invoice'}
        </h1>
        {checkout.payee ? (
          <p className="mt-1 break-words font-body text-ui text-slate">From {checkout.payee}</p>
        ) : null}
      </div>

      <div className="border-t border-hairline px-5 py-5">
        <p className="font-body text-note text-slate">Amount due</p>
        <div className="mt-2">
          {checkout.amountMinor !== undefined ? (
            <CheckoutAmount checkout={checkout} />
          ) : (
            <p className="text-pretty font-body text-ui text-ink">
              No amount was set on this invoice. You will enter how much to send in the next step.
            </p>
          )}
        </div>
      </div>

      {due || checkout.reference || checkout.note ? (
        <dl className="divide-y divide-hairline border-t border-hairline px-5 py-1.5">
          {due ? <Row label="Due date">{due.date}</Row> : null}
          {checkout.reference ? <Row label="Reference">{checkout.reference}</Row> : null}
          {checkout.note ? <Row label="Description">{checkout.note}</Row> : null}
        </dl>
      ) : null}

      <p className="border-t border-hairline bg-press px-5 py-3.5 font-body text-note text-slate">
        Payments made with Entole reach {who} within seconds.
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Ways to pay
// ---------------------------------------------------------------------------

const PRIMARY =
  'flex h-14 w-full items-center justify-center gap-2 rounded-control bg-ink font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px';
const SECONDARY =
  'flex h-14 w-full items-center justify-center gap-2 rounded-control border border-line bg-card font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px';
const QUIET =
  'flex h-12 w-full items-center justify-center rounded-control font-strong text-ui text-slate transition-colors hover:bg-press active:translate-y-px';

/**
 * How to pay, led by whichever way works for someone who has nothing
 * installed. With a payment partner configured (`lib/onramp.ts`) that is a
 * bank or card; without one it is Entole in this browser, which needs no
 * download. Opening the phone app comes after either: it only works for
 * someone who already has it. Until a partner exists, bank and card stay on
 * the page as a button that cannot be pressed and says so, below the ways
 * that work; it is never a link that pretends.
 */
export function PaymentOptions({ checkout, onrampUrl }: { checkout: Checkout; onrampUrl: string | null }) {
  const recipientAccount = checkout.payee ? `${checkout.payee}'s Entole account` : 'their Entole account';

  return (
    <section aria-labelledby="pay-options" className="pt-10">
      <h2 id="pay-options" className="pb-3 font-display text-subhead text-ink">
        How would you like to pay?
      </h2>

      <div className="flex flex-col gap-2.5">
        {onrampUrl ? (
          <a href={onrampUrl} rel="noopener noreferrer" className={PRIMARY}>
            Pay with bank or card
            <ArrowUpRight size={18} strokeWidth={1.75} aria-hidden />
          </a>
        ) : null}
        <Link href={browserSendPathFor(checkout)} className={onrampUrl ? SECONDARY : PRIMARY}>
          Pay with Entole
        </Link>
        <a href={appLinkFor(checkout)} className={onrampUrl ? QUIET : SECONDARY}>
          Open in the Entole app
        </a>
        {onrampUrl ? null : (
          <button
            type="button"
            disabled
            className="flex h-14 w-full cursor-not-allowed items-center justify-center rounded-control bg-press font-strong text-prose text-mist"
          >
            Bank and card payments open soon
          </button>
        )}
      </div>

      {onrampUrl ? (
        <p className="mt-3 text-pretty font-body text-note text-slate">
          No app and no account needed. You pay from your bank or card, and it arrives in {recipientAccount}.
        </p>
      ) : (
        <p className="mt-3 text-pretty font-body text-note text-slate">
          Entole opens here in your browser, with nothing to download. If you are new, making an account takes a
          name and your fingerprint.
        </p>
      )}

      <Notice>
        {AUTHORED_BY_SENDER} Payment code ending {codeLabel(checkout)}.
      </Notice>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Not a link
// ---------------------------------------------------------------------------

/** Nothing from the link is echoed here — it did not parse, so none of it can be trusted. */
export function InvalidCheckout() {
  return (
    <section aria-labelledby="checkout-title" className="pt-16">
      <h1 id="checkout-title" className="font-display text-heading text-ink">
        This link isn&apos;t valid
      </h1>
      <p className="mt-3 max-w-[34ch] text-pretty font-body text-prose text-slate">
        It may have been cut short when it was copied. Ask the person who sent it to share it again.
      </p>
    </section>
  );
}
