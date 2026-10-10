'use client';

import { useState } from 'react';

import { toNaira } from '@entole/core/fx';
import { cents, formatNaira } from '@entole/core/money';
import { useStore } from '@entole/core/store';
import { useStockDetail } from '@entole/core/stock-browse';
import { formatBig, formatChange, formatUsd, type StockDetail } from '@entole/core/stock-market';
import {
  changeTone,
  formatPercent,
  formatStockDay,
  historyChange,
  historyLine,
  stockByline,
  tradingStatus,
} from '@entole/core/stock-view';

import { Header } from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { StockLogo } from '@/components/StockLogo';
import { stockMarket } from '@/lib/stocks';

const TONE = { up: 'text-settled', down: 'text-halt', flat: 'text-slate' } as const;
const CHART = { width: 320, height: 96 } as const;
/** A few lines fit as they are; anything longer folds behind "Read more". */
const ABOUT_FOLDS_AT = 220;

/**
 * One stock, to look at: its price and how it moved, a month of closes, how
 * much of it was traded, what the company is worth, its range over a year and
 * a few lines about it. Every figure is read live through `stockMarket`; if it
 * cannot be read the page says so and shows no figure at all.
 *
 * Buying is not open, so the one action is a button that cannot be pressed.
 * Nothing on this page can move money.
 */
export function StockPreview({ symbol }: { symbol: string }) {
  const store = useStore();
  const look = useStockDetail(stockMarket, symbol);
  const detail = look.detail;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title={symbol} back="/grow/stocks" />

      <div className="flex-1 px-gutter pb-28">
        {look.state === 'loading' ? (
          <div aria-label="Getting the latest price" className="px-1 pt-1">
            <div className="flex items-center gap-3">
              <Skeleton className="h-[52px] w-[52px] flex-none rounded-pill" />
              <div className="flex-1">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
            </div>
            <Skeleton className="mt-7 h-[42px] w-48" />
            <Skeleton className="mt-3 h-4 w-40" />
            <Skeleton className="mt-6 h-32 w-full rounded-card" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Skeleton className="h-[84px] rounded-row" />
              <Skeleton className="h-[84px] rounded-row" />
            </div>
          </div>
        ) : !detail ? (
          <div className="rounded-panel border border-line bg-card p-5">
            <p className="font-heavy text-body text-ink">We can&apos;t show this stock right now</p>
            <p className="mt-2 text-pretty font-body text-body-sm text-slate">
              Its price is read live from the market, and it could not be reached just now. Nothing has changed.
            </p>
            <button
              type="button"
              onClick={look.retry}
              className="mt-4 flex h-12 items-center justify-center rounded-control border border-line bg-card px-5 font-strong text-body-sm text-ink transition-colors hover:border-mist active:translate-y-px"
            >
              Try again
            </button>
          </div>
        ) : (
          <StockFacts detail={detail} nairaPrice={store.status === 'ready' ? formatNaira(toNaira(cents(detail.priceCents), store.rate)) : null} />
        )}
      </div>
    </main>
  );
}

function StockFacts({ detail, nairaPrice }: { detail: StockDetail; nairaPrice: string | null }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutFolds = (detail.about?.length ?? 0) > ABOUT_FOLDS_AT;
  const month = historyChange(detail.history);
  const line = historyLine(detail.history, CHART.width, CHART.height, 4);

  const facts: { label: string; value: string; note?: string }[] = [];
  if (detail.volume !== undefined) {
    facts.push({
      label: 'Shares traded',
      value: formatBig(detail.volume),
      ...(detail.averageVolume ? { note: `Usually ${formatBig(detail.averageVolume)}` } : {}),
    });
  }
  if (detail.marketCap) {
    facts.push({ label: detail.kind === 'fund' ? 'Fund size' : 'Company value', value: `$${formatBig(detail.marketCap)}` });
  }
  if (detail.yearLowCents && detail.yearHighCents) {
    facts.push({ label: 'Lowest in a year', value: formatUsd(detail.yearLowCents) });
    facts.push({ label: 'Highest in a year', value: formatUsd(detail.yearHighCents) });
  }
  if (detail.previousCloseCents) facts.push({ label: 'Price the day before', value: formatUsd(detail.previousCloseCents) });
  if (detail.dividendYieldBps) {
    facts.push({ label: 'Paid to owners', value: `${formatPercent(detail.dividendYieldBps)} a year`, note: 'As dividends' });
  }

  return (
    <>
      <div className="flex items-center gap-3 px-1 pt-1">
        <StockLogo src={detail.logo} name={detail.name} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heavy text-headline text-ink">{detail.name}</p>
          <p className="truncate font-body text-label-sm text-slate">
            {stockByline(detail)}
          </p>
        </div>
      </div>

      <div className="px-1 pt-6">
        <p className="tabular font-heavy text-balance-sm text-ink">{formatUsd(detail.priceCents)}</p>
        <p className="mt-2.5 font-body text-label text-slate">
          <span className={`tabular font-strong ${TONE[changeTone(detail.changeBps)]}`}>{formatChange(detail.changeBps)}</span>
          {detail.asOf ? ` on ${formatStockDay(detail.asOf)}` : ' on its last trading day'}
        </p>
        {nairaPrice ? <p className="tabular mt-1 font-body text-label-sm text-slate">About {nairaPrice} a share</p> : null}
      </div>

      {line && month ? (
        <div className="mt-6 rounded-card border border-line bg-card p-4">
          <div className="flex items-baseline justify-between">
            <p className="font-body text-label-sm text-slate">Since {formatStockDay(month.since)}</p>
            <p className={`tabular font-strong text-label ${TONE[changeTone(month.changeBps)]}`}>{formatChange(month.changeBps)}</p>
          </div>
          <svg
            role="img"
            aria-label={`Closing price each day since ${formatStockDay(month.since)}`}
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            preserveAspectRatio="none"
            className={`mt-3 h-24 w-full ${TONE[changeTone(month.changeBps)]}`}
          >
            <polyline
              points={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      ) : null}

      {facts.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="rounded-row border border-line bg-card px-4 py-3.5 [&:last-child:nth-child(odd)]:col-span-2"
            >
              <dt className="font-body text-label-sm text-slate">{fact.label}</dt>
              <dd className="tabular mt-1 font-strong text-body-lg text-ink">{fact.value}</dd>
              {fact.note ? <dd className="tabular mt-0.5 font-body text-label-sm text-slate">{fact.note}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {detail.about ? (
        <div className="px-1 pt-6">
          <h2 className="font-heavy text-body-sm text-ink">About</h2>
          <p className={`mt-2 text-pretty font-body text-body-sm text-slate ${aboutOpen || !aboutFolds ? '' : 'line-clamp-4'}`}>
            {detail.about}
          </p>
          {aboutFolds ? (
            <button
              type="button"
              aria-expanded={aboutOpen}
              onClick={() => setAboutOpen((open) => !open)}
              className="mt-1.5 font-strong text-label-sm text-indigo"
            >
              {aboutOpen ? 'Show less' : 'Read more'}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="px-1 pt-6 font-body text-label-sm text-slate">{tradingStatus(detail)}</p>

      <button
        type="button"
        disabled
        aria-disabled
        className="mt-3 flex h-14 w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-control bg-press font-strong text-body-lg text-mist"
      >
        Buy
        <span className="rounded-chip border border-line bg-card px-2 py-0.5 font-strong text-label-sm text-slate">Coming soon</span>
      </button>
      <p className="mt-2.5 text-pretty px-1 text-center font-body text-label-sm text-slate">
        Buying opens soon. Nothing here can move your money yet.
      </p>
    </>
  );
}
