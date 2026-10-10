'use client';

import { FileText, Truck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { formatRate } from '@entole/core/fx';
import { resetLabel } from '@entole/core/format';
import { invoiceCsvFilename, invoicesToCsv } from '@entole/core/invoice-csv';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { AllowanceCardSkeleton, RowSkeleton } from '@/components/Skeleton';

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
 * payment. Mirrors `apps/mobile/app/(tabs)/business.tsx`.
 */
export default function BusinessPage() {
  const store = useStore();
  const loading = store.status === 'loading';
  const [checkingId, setCheckingId] = useState<string | null>(null);
  /** What the last check of a held invoice found, said beside that invoice. */
  const [checked, setChecked] = useState<{ id: string; text: string } | null>(null);

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
      <Header title="Business" />

      <div className="flex-1 px-gutter pb-28">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            <RowSkeleton />
            <AllowanceCardSkeleton />
            <AllowanceCardSkeleton />
          </div>
        ) : (
          <>
            <p className="pb-3 pt-[10px] font-strong text-body-lg text-ink">Services</p>
            <div className="mb-7 grid grid-cols-2 gap-3">
              {SERVICES.map(({ label, hint, Icon, href }) => (
                <Link
                  key={label}
                  href={href}
                  className="rounded-card border border-line bg-card p-4 transition-colors hover:border-mist"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-chip bg-indigo-wash text-indigo">
                    <Icon size={20} strokeWidth={1.5} />
                  </span>
                  <p className="mt-3 font-strong text-body-sm text-ink">{label}</p>
                  <p className="mt-0.5 font-body text-caption-sm text-slate">{hint}</p>
                </Link>
              ))}
            </div>

            {store.taxReserves.length > 0 ? (
              <div className="mb-7 rounded-panel bg-card p-5 shadow-raised">
                <span className="rounded-chip bg-indigo-wash px-2 py-1 font-heavy text-badge uppercase text-indigo">
                  Tax reserve
                </span>
                <p className="tabular mt-3 font-strong text-amount text-ink">
                  {formatNaira(kobo(store.taxReserves[0]!.balanceMinor))}
                </p>
                <p className="mt-1.5 font-body text-label-sm text-slate">
                  Held aside, {resetLabel(store.taxReserves[0]!.payoutAt)}
                </p>
              </div>
            ) : null}

            <div className="flex items-baseline justify-between pb-3 pt-[10px]">
              <p className="font-strong text-body-lg text-ink">Invoices</p>
              <Link href="/business/new-invoice" className="font-strong text-label text-indigo hover:underline">
                New
              </Link>
            </div>
            <div className="flex flex-col gap-2.5">
              {store.invoices.length === 0 ? (
                <p className="font-body text-label-sm text-mist">No invoices yet.</p>
              ) : (
                store.invoices.map((invoice) => (
                  <div key={invoice.id} className="rounded-row border border-line bg-card px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex-1 font-strong text-body text-ink">{invoice.clientName}</span>
                      <span
                        className={`font-heavy text-caption-sm uppercase ${
                          invoice.status === 'paid' ? 'text-settled' : 'text-slate'
                        }`}
                      >
                        {invoice.status === 'pending-release' ? 'Held' : invoice.status}
                      </span>
                    </div>
                    <p className="tabular mt-1.5 font-strong text-amount-sm text-ink">
                      {formatNaira(kobo(invoice.amountMinor))}
                    </p>
                    <p className="mt-0.5 font-body text-caption-sm text-slate">{invoice.note}</p>
                    {invoice.releaseCondition ? (
                      <p className="mt-1.5 font-body text-caption-sm text-slate">
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
                        className="mt-3 rounded-control border border-line bg-card px-4 py-2 font-strong text-label-sm text-ink hover:border-mist disabled:opacity-60"
                      >
                        {checkingId === invoice.id ? 'Checking' : 'Check condition'}
                      </button>
                    ) : null}
                    {checked?.id === invoice.id && invoice.status === 'pending-release' ? (
                      <p role="status" className="mt-2 font-body text-caption-sm text-slate">
                        {checked.text}
                      </p>
                    ) : null}
                    {invoice.status !== 'pending-release' && invoice.status !== 'paid' ? (
                      <button
                        type="button"
                        onClick={() => void store.settleInvoice(invoice.id)}
                        className="mt-3 rounded-control border border-line bg-card px-4 py-2 font-strong text-label-sm text-ink hover:border-mist"
                      >
                        Mark as paid
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {store.invoices.length > 0 ? (
              <button
                type="button"
                onClick={exportInvoices}
                className="mt-3 flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-label text-ink transition-colors hover:border-mist"
              >
                Download for your accountant
              </button>
            ) : null}

          </>
        )}
      </div>
    </main>
  );
}
