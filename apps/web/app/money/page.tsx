'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { toDollars } from '@entole/core/fx';
import { formatDollars } from '@entole/core/money';
import { pocketsOpeningFrom } from '@entole/core/pockets-link';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/Amount';
import { Header } from '@/components/Header';
import { PocketsSection } from '@/components/Pockets';
import { SavingsCard, StocksRow } from '@/components/SavingsCard';
import { SectionHeading } from '@/components/SectionHeading';
import { BalanceSkeleton } from '@/components/Skeleton';

/**
 * Money: everything the person holds, in one column. The naira balance as a
 * line on paper, then the pockets in other currencies, then savings (the one
 * raised surface) and stocks. What used to be Grow lives here; `/grow/*`
 * still opens. Mirrors `apps/mobile/app/(tabs)/money.tsx`.
 */
export default function MoneyPage() {
  const store = useStore();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Money" />

      <div className="flex-1 px-gutter pb-28">
        {store.status === 'loading' ? (
          <BalanceSkeleton />
        ) : store.status === 'failed' ? (
          // No figure at all: a zero here would read as the balance.
          <section className="border-b border-hairline pb-5 pt-1">
            <p className="font-strong text-ui text-ink">We couldn&apos;t load your account.</p>
            <p className="mt-1 text-pretty font-body text-note text-slate">Your money is where you left it.</p>
            <button
              type="button"
              onClick={() => void store.refresh().catch(() => undefined)}
              className="mt-2 min-h-11 font-strong text-ui text-ink underline decoration-mist underline-offset-4 hover:decoration-ink"
            >
              Try again
            </button>
          </section>
        ) : (
          <section aria-label="Your Entole balance" className="border-b border-hairline pb-5 pt-1">
            <p className="font-strong text-note text-slate">Entole balance</p>
            <div className="mt-1.5">
              <Amount value={store.balance} size="small" />
            </div>
            <p className="tabular mt-1.5 font-body text-note text-slate">
              about {formatDollars(toDollars(store.balance, store.rate))}
            </p>
          </section>
        )}

        <Suspense fallback={<PocketsSection />}>
          <PocketsFromLink />
        </Suspense>

        <SectionHeading title="Savings and stocks" />
        <SavingsCard />
        <StocksRow />
      </div>
    </main>
  );
}

/** Pockets, with a sheet opened and filled in when the link asks for one (Ayo's "change 100 dollars to euros"). */
function PocketsFromLink() {
  const query = useSearchParams();
  const link = query.toString();
  // Keyed by the link, so asking again while already here opens the sheet again.
  const params = new URLSearchParams(link);
  return <PocketsSection key={link} opening={pocketsOpeningFrom((key) => params.get(key))} />;
}
