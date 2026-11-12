'use client';

import { ChevronRight, Sprout, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { formatNaira, kobo } from '@entole/core/money';
import { savingsEarning } from '@entole/core/savings';
import { useStore } from '@entole/core/store';

import { BalanceSkeleton } from './Skeleton';

/**
 * Savings, raised: the owner's own money set aside, earning only where it is
 * really held somewhere that pays. The rate and what was earned are read only
 * through `savingsEarning`, which answers nothing unless the rate is real.
 * Shown on Money and on the Grow page that links still open.
 */
export function SavingsCard() {
  const store = useStore();
  const savings = store.growPosition;
  // Only ever a rate read from where the money is held. Null means it earns nothing.
  const earning = savingsEarning(savings);

  if (store.status === 'loading' || !savings) return <BalanceSkeleton />;

  return (
    <Link href="/grow/savings" aria-label="Savings" className="block rounded-card bg-card p-5 shadow-raised transition-transform active:translate-y-px">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Sprout size={20} strokeWidth={1.5} aria-hidden className="text-settled" />
          <span className="font-strong text-ui text-ink">Savings</span>
        </div>
        <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="text-mist" />
      </div>
      <p className="tabular mt-4 font-display text-figure-sm text-ink">{formatNaira(kobo(savings.balanceMinor))}</p>
      <p className="mt-1 font-body text-note text-slate">
        {!earning
          ? "Money set aside, separate from what you spend. It doesn't earn interest yet."
          : earning.earnedMinor > 0
            ? `+ ${formatNaira(kobo(earning.earnedMinor))} earned so far`
            : `Earning about ${earning.rate} a year.`}
      </p>
    </Link>
  );
}

/** Stocks as one ruled row: what is held once buying is open, a place to look until then. */
export function StocksRow() {
  const store = useStore();
  const holdingsValue = store.stockPositions.reduce((sum, position) => sum + position.currentValueMinor, 0);

  return (
    <Link
      href="/grow/stocks"
      aria-label="Stocks"
      className="mt-4 block border-b border-hairline px-1 py-5 transition-colors hover:bg-press"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TrendingUp size={20} strokeWidth={1.5} aria-hidden className="text-ink" />
          <span className="font-strong text-ui text-ink">Stocks</span>
        </div>
        <ChevronRight size={18} strokeWidth={1.5} aria-hidden className="text-mist" />
      </div>
      {store.stocksAvailable ? (
        <>
          <p className="tabular mt-3 font-display text-subhead text-ink">{formatNaira(kobo(holdingsValue))}</p>
          <p className="mt-1 font-body text-note text-slate">
            {store.stockPositions.length > 0
              ? `${store.stockPositions.length} ${store.stockPositions.length === 1 ? 'holding' : 'holdings'}`
              : 'Buy your first share.'}
          </p>
        </>
      ) : (
        <p className="mt-2 text-pretty font-body text-note text-slate">
          See the companies and funds you will be able to buy, with live prices. Buying opens soon.
        </p>
      )}
    </Link>
  );
}
