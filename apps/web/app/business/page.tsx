'use client';

import Link from 'next/link';
import { useState } from 'react';

import { formatRate } from '@entole/core/fx';
import { resetLabel } from '@entole/core/format';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { AllowanceCard } from '@/components/AllowanceCard';
import { Avatar } from '@/components/Avatar';
import { Header } from '@/components/Header';
import { AllowanceCardSkeleton, RowSkeleton } from '@/components/Skeleton';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', officer: 'Officer', bookkeeper: 'Bookkeeper' };

/**
 * Seats, invoices and the tax reserve. Everything on this page either is an
 * allowance already, or settles into one — mirrors
 * `apps/mobile/app/(tabs)/business.tsx`.
 */
export default function BusinessPage() {
  const store = useStore();
  const loading = store.status === 'loading';
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const spendingSeats = store.seats.filter((seat) => seat.limitMinor > 0);
  const otherSeats = store.seats.filter((seat) => seat.limitMinor === 0);

  async function checkRelease(invoiceId: string) {
    setCheckingId(invoiceId);
    try {
      await store.requestConditionalRelease(invoiceId, store.rate);
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
                    ) : invoice.status !== 'paid' ? (
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

            <div className="flex items-baseline justify-between pb-3 pt-[30px]">
              <p className="font-strong text-body-lg text-ink">Seats</p>
              <Link href="/business/new-seat" className="font-strong text-label text-indigo hover:underline">
                Add
              </Link>
            </div>
            <div className="flex flex-col gap-2.5">
              {spendingSeats.map((seat) => (
                <AllowanceCard key={seat.id} allowance={seat} resetsAt={seat.resetsAt} />
              ))}
              {otherSeats.map((seat) => {
                const contact = store.contact(seat.recipientId);
                return (
                  <div
                    key={seat.id}
                    className="flex items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3"
                  >
                    <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} />
                    <span className="flex-1 font-strong text-body text-ink">{contact?.name ?? seat.name}</span>
                    <span className="font-heavy text-caption-sm uppercase text-slate">{ROLE_LABEL[seat.role]}</span>
                  </div>
                );
              })}
              {store.seats.length === 0 ? (
                <p className="font-body text-label-sm text-mist">No seats granted yet.</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
