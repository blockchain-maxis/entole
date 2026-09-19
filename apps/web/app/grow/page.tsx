'use client';

import { ChevronRight, Sprout, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';
import { BalanceSkeleton } from '@/components/Skeleton';

/**
 * The Grow hub — two products, each a card into its own flow. Savings is the
 * owner's own balance growing; Stocks is buying and selling shares. Mirrors
 * `apps/mobile/app/(tabs)/grow.tsx`.
 */
export default function GrowHubPage() {
  const store = useStore();
  const loading = store.status === 'loading';
  const savings = store.growPosition;
  const holdingsValue = store.stockPositions.reduce((sum, p) => sum + p.currentValueMinor, 0);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Grow" />

      <div className="flex-1 px-gutter pb-28">
        {loading || !savings ? (
          <BalanceSkeleton />
        ) : (
          <div className="flex flex-col gap-3">
            <Link href="/grow/savings" aria-label="Savings" className="block rounded-panel bg-card p-5 shadow-raised">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Sprout size={20} strokeWidth={1.5} className="text-settled" />
                  <span className="font-heavy text-body text-ink">Savings</span>
                </div>
                <ChevronRight size={18} strokeWidth={1.5} className="text-mist" />
              </div>
              <p className="tabular mt-4 font-heavy text-amount text-ink">{formatNaira(kobo(savings.balanceMinor))}</p>
              <p className="mt-1 font-body text-label-sm text-slate">
                {savings.accruedMinor > 0
                  ? `+ ${formatNaira(kobo(savings.accruedMinor))} earned so far`
                  : 'Put money aside and watch it grow.'}
              </p>
            </Link>

            <Link href="/grow/stocks" aria-label="Stocks" className="block rounded-panel border border-line bg-card p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <TrendingUp size={20} strokeWidth={1.5} className="text-indigo" />
                  <span className="font-heavy text-body text-ink">Stocks</span>
                </div>
                <ChevronRight size={18} strokeWidth={1.5} className="text-mist" />
              </div>
              {store.stocksAvailable ? (
                <>
                  <p className="tabular mt-4 font-heavy text-amount text-ink">{formatNaira(kobo(holdingsValue))}</p>
                  <p className="mt-1 font-body text-label-sm text-slate">
                    {store.stockPositions.length > 0
                      ? `${store.stockPositions.length} ${store.stockPositions.length === 1 ? 'holding' : 'holdings'}`
                      : 'Buy your first share.'}
                  </p>
                </>
              ) : (
                <p className="mt-3 font-body text-label-sm text-slate">Not available yet.</p>
              )}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
