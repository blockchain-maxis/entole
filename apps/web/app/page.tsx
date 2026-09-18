'use client';

import { toDollars } from '@entole/core/fx';
import { formatDollars, formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { ActivityRow } from '@/components/ActivityRow';
import { AllowanceCard } from '@/components/AllowanceCard';
import { Amount } from '@/components/Amount';
import { ButtonLink } from '@/components/Button';
import { Header } from '@/components/Header';
import {
  AllowanceCardSkeleton,
  BalanceSkeleton,
  RowSkeleton,
} from '@/components/Skeleton';

export default function Home() {
  const store = useStore();
  const loading = store.status === 'loading';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header />

      <div className="flex-1 px-gutter pb-8">
        {loading ? (
          <BalanceSkeleton />
        ) : (
          <section className="px-1 pb-[34px] pt-[22px]">
            <p className="font-strong text-label-sm text-mist">Available balance</p>
            <div className="mt-2.5">
              <Amount value={store.balance} />
            </div>
            <p className="tabular mt-3 font-body text-body-sm text-slate">
              ≈ {formatDollars(toDollars(store.balance, store.rate))}
            </p>
          </section>
        )}

        <SectionHeading title="Allowances" />

        <ul className="flex flex-col gap-2.5">
          {loading ? (
            <>
              <AllowanceCardSkeleton />
              <AllowanceCardSkeleton />
              <AllowanceCardSkeleton />
            </>
          ) : (
            store.allowances.map((allowance) => (
              <AllowanceCard
                key={allowance.id}
                allowance={allowance}
                resetsAt={allowance.resetsAt}
              />
            ))
          )}
        </ul>

        <SectionHeading title="Recent activity" action={{ label: 'All', href: '/activity' }} />

        <ul className="flex flex-col gap-2">
          {loading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            store.activity
              .slice(0, 5)
              .map((entry) => (
                <ActivityRow key={entry.id} entry={entry} contact={store.contact(entry.contactId)} />
              ))
          )}
        </ul>

        {!loading && (store.seats.length > 0 || store.invoices.length > 0) ? (
          <>
            <SectionHeading title="Business" />

            {store.taxReserves.length > 0 ? (
              <div className="mb-3 rounded-card border border-line bg-card p-5">
                <span className="rounded-md bg-indigo-wash px-2 py-1 font-heavy text-badge uppercase text-indigo">
                  Tax reserve
                </span>
                <p className="tabular mt-3 font-strong text-amount-sm text-ink">
                  {formatNaira(kobo(store.taxReserves[0]!.balanceMinor))}
                </p>
              </div>
            ) : null}

            <ul className="flex flex-col gap-2.5">
              {store.seats.map((seat) => (
                <AllowanceCard key={seat.id} allowance={seat} resetsAt={seat.resetsAt} />
              ))}
            </ul>

            {store.invoices.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-2">
                {store.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex items-center justify-between rounded-row border border-line bg-card px-4 py-3"
                  >
                    <span className="font-strong text-body-sm text-ink">{invoice.clientName}</span>
                    <span className="tabular font-body text-label-sm text-slate">
                      {formatNaira(kobo(invoice.amountMinor))} · {invoice.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {store.paused ? <PausedBanner onResume={() => void store.setPaused(false)} /> : null}
      </div>

      <div className="sticky bottom-0 flex gap-2.5 border-t border-hairline bg-paper px-gutter pt-4 safe-bottom">
        <ButtonLink href="/activity" label="Send money" />
        <ButtonLink href="/activity" label="Receive" variant="secondary" />
      </div>
    </main>
  );
}

function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-baseline justify-between pb-3 pt-[30px] first:pt-0">
      <h2 className="font-strong text-body-lg text-ink">{title}</h2>
      {action ? (
        <a href={action.href} className="font-strong text-label text-indigo hover:underline">
          {action.label}
        </a>
      ) : null}
    </div>
  );
}

function PausedBanner({ onResume }: { onResume: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-control bg-ink px-4 py-3.5">
      <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-[2px] bg-halt" />
      <p className="flex-1 font-body text-label text-paper">
        All allowances paused. Nothing is lost.
      </p>
      <button type="button" onClick={onResume} className="font-strong text-label text-card underline">
        Resume
      </button>
    </div>
  );
}
