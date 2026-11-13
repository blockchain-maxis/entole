'use client';

import { ChevronRight, FileText, Truck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { formatRate } from '@entole/core/fx';
import { MOVEMENT_WORDS } from '@entole/core/intents-pockets';
import { invoiceCsvFilename, invoicesToCsv } from '@entole/core/invoice-csv';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { EmptyState } from '@/components/EmptyState';
import { InvoiceSheet } from '@/components/InvoiceSheet';
import { Header } from '@/components/Header';
import { TaxReserveCard } from '@/components/TaxReserveCard';
import { AllowanceCardSkeleton, RowSkeleton } from '@/components/Skeleton';
import { paidFromWords, useInvoicePayments } from '@/lib/invoice-follow';

type Service = { label: string; hint: string; Icon: LucideIcon; href: string };

// Team seats and supply requests are not offered here. A seat was drawn with an
// allowance meter but nothing enforced it, and a supply request was kept only
// until the page reloaded. Neither is shown until it is real.
const SERVICES: Service[] = [
  { label: 'Send invoice', hint: 'Bill a client', Icon: FileText, href: '/business/new-invoice' },
  { label: 'Pay a supplier', hint: 'Send money out', Icon: Truck, href: '/business/pay-supplier' },
];

/**
 * Services on top, invoices below. Only what really happens is on this page:
 * an invoice is a request with a link, and paying a supplier is an ordinary
 * payment. An invoice paid from another app is marked paid only once that
 * payment has arrived, and says where it was paid from. Each invoice opens in
 * a sheet with its pay link, to copy or share, as the phone's invoice screen
 * does. Business left the tab bar on 12 November; it opens from Me and from Pay.
 * Mirrors `apps/mobile/app/business/index.tsx`.
 */
export default function BusinessPage() {
  const store = useStore();
  const loading = store.status === 'loading';
  const [checkingId, setCheckingId] = useState<string | null>(null);
  /** What the last check of a held invoice found, said beside that invoice. */
  const [checked, setChecked] = useState<{ id: string; text: string } | null>(null);
  /** Payments from another app still under way, by invoice. */
  const underWay = useInvoicePayments();
  /** The invoice open in the sheet, by id, so it shows the latest of that invoice. */
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? store.invoices.find((invoice) => invoice.id === openId) : undefined;

  /** The invoices as a spreadsheet, with the rate at the day each was paid. */
  function exportInvoices() {
    const blob = new Blob([invoicesToCsv(store.invoices, { bom: true })], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = invoiceCsvFilename();
    link.click();
    URL.revokeObjectURL(url);
  }

  async function checkRelease(invoiceId: string) {
    setCheckingId(invoiceId);
    setChecked(null);
    try {
      const released = await store.requestConditionalRelease(invoiceId, store.rate);
      // Released, the invoice reads "sent" and needs no note. Still held, say why.
      if (!released) setChecked({ id: invoiceId, text: `Not yet. The rate now is ${formatRate(store.rate)}.` });
    } catch {
      setChecked({ id: invoiceId, text: "We couldn't check that just now. Nothing changed. Try again." });
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Business" back="/me" />

      <div className="flex-1 px-gutter pb-28">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            <RowSkeleton />
            <AllowanceCardSkeleton />
            <AllowanceCardSkeleton />
          </div>
        ) : (
          <>
            <h2 className="pb-3 pt-[10px] font-display text-subhead text-ink">Services</h2>
            <div className="mb-4 border-t border-hairline">
              {SERVICES.map(({ label, hint, Icon, href }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center gap-3.5 border-b border-hairline py-3.5 transition-colors hover:bg-press"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-press text-ink">
                    <Icon size={20} strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-strong text-ui text-ink">{label}</span>
                    <span className="mt-0.5 block font-body text-note text-slate">{hint}</span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.5} className="flex-none text-mist" />
                </Link>
              ))}
            </div>

            <TaxReserveCard />

            <div className="flex items-baseline justify-between pb-3 pt-8">
              <h2 className="font-display text-subhead text-ink">Invoices</h2>
              <Link
                href="/business/new-invoice"
                className="-my-3 -mr-3 inline-flex min-h-11 items-center px-3 font-strong text-ui text-ink underline decoration-mist underline-offset-4 transition-colors hover:decoration-ink"
              >
                New invoice
              </Link>
            </div>
            <div className="flex flex-col">
              {store.invoices.length === 0 ? (
                <EmptyState
                  body="No invoices yet. Send one and it is listed here, with what is owed and when it was paid."
                  action={{ label: 'Send an invoice', href: '/business/new-invoice' }}
                />
              ) : (
                store.invoices.map((invoice) => (
                  <div key={invoice.id} className="border-b border-hairline">
                    <button
                      type="button"
                      onClick={() => setOpenId(invoice.id)}
                      className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-control px-3 py-3.5 text-left transition-colors hover:bg-press active:translate-y-px"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 flex-1 truncate font-strong text-ui text-ink">{invoice.clientName}</span>
                          <span
                            className={`flex-none font-heavy text-note uppercase ${
                              invoice.status === 'paid' ? 'text-settled' : 'text-slate'
                            }`}
                          >
                            {invoice.status === 'pending-release' ? 'Held' : invoice.status}
                          </span>
                        </span>
                        <span className="tabular mt-1.5 block font-strong text-subhead text-ink">
                          {formatNaira(kobo(invoice.amountMinor))}
                        </span>
                        <span className="mt-0.5 block font-body text-note text-slate">
                          {invoice.reference ? `${invoice.reference} · ` : ''}
                          {invoice.note}
                        </span>
                        {invoice.status === 'paid' && invoice.paidVia ? (
                          <span className="mt-1.5 block font-body text-note text-settled">Paid from {invoice.paidVia.source}</span>
                        ) : underWay[invoice.id] ? (
                          <span className="mt-1.5 block font-body text-note text-slate">
                            From {paidFromWords(underWay[invoice.id]!.source)}: {MOVEMENT_WORDS[underWay[invoice.id]!.state].toLowerCase()}
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="flex-none text-mist" />
                    </button>
                    <div className={invoice.releaseCondition || invoice.status === 'pending-release' ? 'pb-3.5' : undefined}>
                      {invoice.releaseCondition ? (
                        <p className="-mt-1.5 font-body text-note text-slate">
                          Releases at{' '}
                          {formatRate({ koboPerDollar: invoice.releaseCondition.maxKoboPerDollar, quotedAt: '' })} or
                          better · now {formatRate(store.rate)}
                        </p>
                      ) : null}
                      {invoice.status === 'pending-release' ? (
                        <button
                          type="button"
                          disabled={checkingId === invoice.id}
                          onClick={() => void checkRelease(invoice.id)}
                          className="mt-1 inline-flex min-h-11 items-center rounded-control border border-line bg-card px-4 font-strong text-note text-ink hover:border-mist disabled:opacity-60"
                        >
                          {checkingId === invoice.id ? 'Checking' : 'Check condition'}
                        </button>
                      ) : null}
                      {checked?.id === invoice.id && invoice.status === 'pending-release' ? (
                        <p role="status" className="mt-2 font-body text-note text-slate">
                          {checked.text}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            {store.invoices.length > 0 ? (
              <button
                type="button"
                onClick={exportInvoices}
                className="mt-3 flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-ui text-ink transition-colors hover:border-mist"
              >
                Download for your accountant
              </button>
            ) : null}
          </>
        )}
      </div>

      {open ? <InvoiceSheet invoice={open} underWay={underWay[open.id]} onDismiss={() => setOpenId(null)} /> : null}
    </main>
  );
}
