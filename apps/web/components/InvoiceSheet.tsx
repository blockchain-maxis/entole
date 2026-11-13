'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { buildPayLink, parsePayLink } from '@entole/core/checkout-link';
import { MOVEMENT_WORDS } from '@entole/core/intents-pockets';
import type { InvoicePaymentState } from '@entole/core/invoice-pay';
import { dueDateLabel, INVOICE_STATUS_LABEL, invoiceDisplayStatus, localDay, type InvoiceDisplayStatus } from '@entole/core/invoices';
import { formatNaira, kobo } from '@entole/core/money';
import type { Invoice } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { useAccount } from '@/lib/account';
import { paidFromWords } from '@/lib/invoice-follow';
import { plainMessage } from '@/lib/send';
import { useUsernameClaim } from '@/lib/username-claim';

import { GlassSheet } from './GlassSheet';
import { LogoLoader } from './LogoLoader';
import { QrCode } from './QrCode';
import { Skeleton } from './Skeleton';

const PRIMARY =
  'flex h-14 flex-1 items-center justify-center gap-2.5 rounded-control bg-ink px-4 font-strong text-prose text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY =
  'flex h-14 flex-1 items-center justify-center rounded-control border border-line bg-card px-4 font-strong text-prose text-ink transition-colors hover:border-mist active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60';

const CHIP: Record<InvoiceDisplayStatus, string> = {
  sent: 'bg-track text-slate',
  draft: 'bg-track text-slate',
  paid: 'bg-settled-wash text-settled',
  overdue: 'bg-halt-wash text-halt',
  held: 'bg-track text-caution',
};

const noSubscription = () => () => undefined;

/** Whether this browser has a share sheet. False on the server and while hydrating. */
function useCanShare(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === 'function',
    () => false,
  );
}

/**
 * The link an invoice is paid through. The one saved with the invoice is the
 * one that was shared, so it stays as it was. An invoice saved before pay
 * links were usernames has one in the old, long form: that still opens for
 * whoever has it, but what is shown and shared from here is the same invoice
 * by username. Mirrors `apps/mobile/app/business/invoice/[id].tsx`.
 */
function useInvoiceLink(invoice: Invoice): string | null {
  const { account } = useAccount();
  const claim = useUsernameClaim();
  const username = claim === 'held' ? account?.username : undefined;
  const origin = useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => '',
  );
  if (invoice.link && parsePayLink(invoice.link)) return invoice.link;
  if (!username || !origin) return null;
  return buildPayLink(origin, {
    username,
    kind: 'invoice',
    amountMinor: invoice.amountMinor,
    currency: 'NGN',
    ...(invoice.reference ? { reference: invoice.reference } : {}),
    note: invoice.note,
    dueAt: localDay(invoice.dueAt),
  });
}

/**
 * One invoice, in a sheet over the Business page: where it stands, the link a
 * client pays through (as a scan code and as text), and the ways to send it.
 * A payment from another app still on its way says where it has got to; the
 * invoice is marked paid only once it has arrived, and then says where it was
 * paid from. Marking it paid by hand asks first, in place.
 */
export function InvoiceSheet({
  invoice,
  underWay,
  onDismiss,
}: {
  invoice: Invoice;
  /** The latest payment from another app still on its way to this invoice. */
  underWay: InvoicePaymentState | undefined;
  onDismiss: () => void;
}) {
  const store = useStore();
  const { account } = useAccount();
  const link = useInvoiceLink(invoice);
  const canShare = useCanShare();
  const needsUsername = !link && Boolean(account) && !account?.username;

  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [marking, setMarking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const status = invoiceDisplayStatus(invoice);
  const paid = invoice.status === 'paid';
  const held = invoice.status === 'pending-release';
  const following = paid ? undefined : underWay;
  const title = invoice.reference ?? 'Invoice';

  async function copy() {
    if (!link) return;
    setProblem(null);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setProblem("We couldn't copy that here. Press and hold the link to copy it yourself.");
    }
  }

  async function share() {
    if (!link) return;
    setProblem(null);
    const from = account?.displayName.trim() ? ` from ${account.displayName.trim()}` : '';
    const ref = invoice.reference ? ` ${invoice.reference}` : '';
    try {
      await navigator.share({
        title: `Invoice${ref}`,
        text: `Invoice${ref}${from} for ${formatNaira(kobo(invoice.amountMinor))}, due ${dueDateLabel(invoice.dueAt)}`,
        url: link,
      });
    } catch {
      // Closing the share sheet is not an error.
    }
  }

  async function markPaid() {
    if (marking) return;
    setMarking(true);
    setProblem(null);
    try {
      await store.settleInvoice(invoice.id);
      setAsking(false);
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't update that invoice. Try again."));
    } finally {
      setMarking(false);
    }
  }

  return (
    <GlassSheet label={`Invoice ${title}`} onDismiss={onDismiss} locked={marking}>
      <div className="pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-strong text-prose text-ink">{title}</h2>
          <span className={`flex-none rounded-md px-2 py-1 font-heavy text-micro uppercase ${CHIP[status]}`}>
            {INVOICE_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="mt-3 line-clamp-2 font-display text-subhead text-ink">{invoice.clientName}</p>
        <p className="tabular mt-1 font-strong text-heading text-ink">{formatNaira(kobo(invoice.amountMinor))}</p>
        <p className="mt-2 text-pretty font-body text-ui text-slate">{invoice.note}</p>
        <p className="tabular mt-1 font-body text-ui text-slate">
          {paid && invoice.paidAt
            ? invoice.paidVia
              ? `Paid on ${dueDateLabel(invoice.paidAt)}`
              : `Marked as paid on ${dueDateLabel(invoice.paidAt)}`
            : `Due ${dueDateLabel(invoice.dueAt)}`}
        </p>
        {paid && invoice.paidVia ? (
          <p className="mt-1 font-strong text-ui text-settled">Paid from {invoice.paidVia.source}</p>
        ) : null}
      </div>

      {following ? (
        <div role="status" className="mt-5 flex items-center gap-2.5 border-y border-hairline py-3.5">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 flex-none rounded-pill ${
              following.state === 'failed' || following.state === 'returned' ? 'bg-halt' : 'bg-caution'
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-strong text-ui text-ink">{MOVEMENT_WORDS[following.state]}</span>
            <span className="mt-0.5 block font-body text-note text-slate">
              From {paidFromWords(following.source)}. Marked paid once it has arrived.
            </span>
          </span>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col items-center rounded-card border border-hairline px-gutter py-6">
        {link ? (
          <>
            <div className="w-full max-w-[200px] rounded-control bg-white p-2">
              <QrCode value={link} label={`Scan code for invoice ${title}`} />
            </div>
            <p className="mt-4 w-full select-all break-all text-center font-body text-note text-slate">
              {link.replace(/^https?:\/\//, '')}
            </p>
          </>
        ) : needsUsername ? (
          <p className="text-pretty text-center font-body text-ui text-slate">
            An invoice is sent as your pay link, and that is made from your username. Choose one on Me and the link
            is ready here.
          </p>
        ) : (
          <div aria-label="Getting the link ready" className="flex w-full flex-col items-center">
            <Skeleton className="h-[200px] w-[200px] rounded-control" />
            <Skeleton className="mt-4 h-4 w-56" />
          </div>
        )}
      </div>

      <p className="mt-4 text-pretty font-body text-note text-slate">
        Send this link to your client. It opens an invoice for exactly this amount, and what they pay arrives in your
        balance.
      </p>

      {problem ? (
        <p role="alert" className="mt-3 text-pretty font-body text-note text-halt">
          {problem}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2.5">
        <button type="button" disabled={!link} onClick={() => void copy()} className={canShare ? SECONDARY : PRIMARY}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {canShare ? (
          <button type="button" disabled={!link} onClick={() => void share()} className={PRIMARY}>
            Share link
          </button>
        ) : null}
      </div>
      <span role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </span>

      {paid || held ? null : (
        <div className="mt-6 border-t border-hairline pt-4">
          {asking ? (
            <>
              <p className="font-strong text-ui text-ink">Mark {title} as paid?</p>
              <p className="mt-1 text-pretty font-body text-note text-slate">
                Only do this if {invoice.clientName} has paid you. It changes this list and nothing else.
              </p>
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  disabled={marking}
                  onClick={() => setAsking(false)}
                  className="flex h-12 flex-1 items-center justify-center rounded-control border border-line bg-card px-4 font-strong text-ui text-ink transition-colors hover:border-mist disabled:opacity-60"
                >
                  Not yet
                </button>
                <button
                  type="button"
                  disabled={marking}
                  onClick={() => void markPaid()}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-control bg-ink px-4 font-strong text-ui text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
                >
                  {marking ? <LogoLoader size={18} label="Marking as paid" mono /> : null}
                  {marking ? 'Marking' : 'Mark as paid'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="font-strong text-ui text-ink">Been paid already?</p>
              <p className="mt-1 text-pretty font-body text-note text-slate">
                A client who pays through the link from another app has it marked paid once the money arrives. For
                anything else, this is a mark you make yourself. It only updates this list — no money moves.
              </p>
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setAsking(true);
                }}
                className="mt-3 inline-flex min-h-11 items-center rounded-control border border-line bg-card px-4 font-strong text-ui text-ink transition-colors hover:border-mist"
              >
                Mark as paid
              </button>
            </>
          )}
        </div>
      )}
    </GlassSheet>
  );
}
