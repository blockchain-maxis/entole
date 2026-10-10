'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useStockBrowse } from '@entole/core/stock-browse';
import { formatChange, formatUsd, type StockKind, type StockListItem } from '@entole/core/stock-market';
import { changeTone, stockByline, stockCountLabel } from '@entole/core/stock-view';

import { RowSkeleton } from '@/components/Skeleton';
import { StockLogo } from '@/components/StockLogo';
import { stockMarket } from '@/lib/stocks';

const FILTERS: { label: string; kind: StockKind | undefined }[] = [
  { label: 'All', kind: undefined },
  { label: 'Companies', kind: 'company' },
  { label: 'Funds', kind: 'fund' },
];

const TONE = { up: 'text-settled', down: 'text-halt', flat: 'text-slate' } as const;

/**
 * Every stock that will be buyable, with its price and how it moved on its
 * last trading day, read live through `stockMarket`. Search, two filters and
 * a page at a time. It is for looking: each row opens the stock, and nothing
 * here can buy one.
 */
export function StockCatalogue() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StockKind | undefined>(undefined);
  const browse = useStockBrowse(stockMarket, { ...(kind ? { kind } : {}), query });

  return (
    <section aria-label="Stocks to look through">
      <label className="flex items-center gap-2.5 rounded-control border border-line bg-card px-4 py-3.5 focus-within:border-indigo">
        <Search size={18} strokeWidth={1.5} className="flex-none text-mist" />
        <input
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a company or symbol"
          aria-label="Search stocks"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent font-body text-body text-ink outline-none placeholder:text-mist"
        />
      </label>

      <div className="mt-3 flex items-center gap-2">
        {FILTERS.map((filter) => {
          const active = filter.kind === kind;
          return (
            <button
              key={filter.label}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(filter.kind)}
              className={`rounded-pill border px-3.5 py-1.5 font-strong text-label-sm transition-colors active:translate-y-px ${
                active ? 'border-indigo bg-indigo-wash text-indigo' : 'border-line bg-card text-slate hover:border-mist'
              }`}
            >
              {filter.label}
            </button>
          );
        })}
        {browse.state === 'ready' && browse.total > 0 ? (
          <p className="tabular ml-auto font-body text-label-sm text-slate">{stockCountLabel(browse.total, kind)}</p>
        ) : null}
      </div>

      <div className="mt-4">
        {browse.state === 'loading' ? (
          <div aria-label="Loading stocks" className="flex flex-col gap-2">
            {Array.from({ length: 7 }, (_, index) => (
              <RowSkeleton key={index} />
            ))}
          </div>
        ) : browse.state === 'failed' ? (
          <div className="rounded-panel border border-line bg-card p-5">
            <p className="font-heavy text-body text-ink">We can&apos;t show stocks right now</p>
            <p className="mt-2 text-pretty font-body text-body-sm text-slate">
              Prices are read live from the market, and it could not be reached just now. Nothing has changed.
            </p>
            <button
              type="button"
              onClick={browse.retry}
              className="mt-4 flex h-12 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-sm text-ink transition-colors hover:border-mist active:translate-y-px"
            >
              Try again
            </button>
          </div>
        ) : browse.items.length === 0 ? (
          <div className="px-1 pt-2">
            <p className="font-strong text-body-sm text-ink">Nothing matches that search</p>
            <p className="mt-1 font-body text-label-sm text-slate">Try the company&apos;s name, or its symbol.</p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {browse.items.map((item) => (
                <li key={item.symbol}>
                  <StockRow item={item} />
                </li>
              ))}
            </ul>

            {browse.loadingMore ? (
              <div aria-label="Loading more stocks" className="mt-2 flex flex-col gap-2">
                <RowSkeleton />
                <RowSkeleton />
              </div>
            ) : browse.hasMore ? (
              <>
                {browse.moreFailed ? (
                  <p className="mt-3 px-1 font-body text-label-sm text-halt">The next ones could not be loaded.</p>
                ) : null}
                <button
                  type="button"
                  onClick={browse.loadMore}
                  className="mt-3 flex h-12 w-full items-center justify-center rounded-control border border-line bg-card font-strong text-body-sm text-ink transition-colors hover:border-mist active:translate-y-px"
                >
                  {browse.moreFailed ? 'Try again' : 'Show more'}
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function StockRow({ item }: { item: StockListItem }) {
  const price = formatUsd(item.priceCents);
  const change = formatChange(item.changeBps);

  return (
    <Link
      href={`/grow/stocks/${encodeURIComponent(item.symbol)}`}
      aria-label={`${item.name}, ${price}, ${change}`}
      className="flex items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 transition-colors hover:border-mist active:translate-y-px"
    >
      <StockLogo src={item.logo} name={item.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-strong text-body-sm text-ink">{item.name}</p>
        <p className="truncate font-body text-label-sm text-slate">
          {stockByline(item)}
        </p>
      </div>
      <div className="flex-none text-right">
        <p className="tabular font-strong text-body-sm text-ink">{price}</p>
        <p className={`tabular font-body text-label-sm ${TONE[changeTone(item.changeBps)]}`}>{change}</p>
      </div>
    </Link>
  );
}
