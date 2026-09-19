'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { EMPTY_ENTRY, entryDisplay, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import type { StockQuote } from '@entole/core/gateway';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';
import { formatShares, stockQuantityForAmount, stockValueForQuantity } from '@entole/core/stock-broker';

import { Header } from '@/components/Header';
import { Keypad } from '@/components/Keypad';

type Side = 'buy' | 'sell';

/**
 * Buy or sell one stock. The price is always the broker's live quote — if it
 * cannot be fetched, the page says so and offers no way to trade; there is no
 * placeholder price. Amounts are entered in naira on the custom keypad and
 * converted to shares at that quote (rounded down, so never more than you
 * entered). Mirrors `apps/mobile/app/grow/stock/[symbol].tsx`.
 */
export default function StockTradePage() {
  const router = useRouter();
  const store = useStore();
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(String(params.symbol ?? '')).toUpperCase();

  const holding = store.stockPositions.find((p) => p.symbol === symbol);

  const [side, setSide] = useState<Side>('buy');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sellAll, setSellAll] = useState(false);

  const { getStockQuote } = store;

  useEffect(() => {
    let live = true;
    getStockQuote(symbol)
      .then((next) => {
        if (live) setQuote(next);
      })
      .catch(() => {
        if (live) setQuoteFailed(true);
      });
    return () => {
      live = false;
    };
  }, [getStockQuote, symbol]);

  const amount = entryToMinor(entry);
  const held = holding?.quantityScaled ?? 0;
  const quantity = !quote
    ? 0
    : side === 'sell' && sellAll
      ? held
      : Math.min(stockQuantityForAmount(amount, quote.priceMinor), side === 'sell' ? held : Number.MAX_SAFE_INTEGER);
  const canSubmit = Boolean(quote) && quantity > 0 && !busy;

  function pickSide(next: Side) {
    setSide(next);
    setSellAll(false);
    setEntry(EMPTY_ENTRY);
    setProblem(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);
    try {
      if (side === 'buy') await store.buyStock(symbol, quantity);
      else await store.sellStock(symbol, quantity);
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setProblem(
        message.startsWith('Your order was received')
          ? message
          : 'That order did not go through. Nothing changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title={holding?.companyName ?? symbol} back="/grow/stocks" />

      <div className="flex-1 px-gutter pb-28">
        {quoteFailed ? (
          <div className="rounded-panel border border-line bg-card p-5">
            <p className="font-heavy text-body text-ink">No price available right now</p>
            <p className="mt-2 font-body text-body-sm text-slate">
              We could not get a live price for {symbol}, so trading it is switched off for now.
            </p>
          </div>
        ) : !quote ? (
          <p className="px-1 font-body text-body-sm text-slate">Getting the latest price</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between px-1">
              <p className="font-strong text-label-sm text-mist">{symbol} · per share</p>
              <p className="tabular font-strong text-body text-ink">{formatNaira(kobo(quote.priceMinor))}</p>
            </div>

            <div className="mt-4 flex gap-2">
              {(['buy', 'sell'] as const).map((option) => {
                const disabled = option === 'sell' && held === 0;
                const active = side === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => pickSide(option)}
                    className={`flex-1 rounded-control border py-3 font-strong text-body-sm ${
                      active ? 'border-indigo bg-indigo-wash text-indigo' : 'border-line bg-card text-slate'
                    } ${disabled ? 'opacity-40' : ''}`}
                  >
                    {option === 'buy' ? 'Buy' : 'Sell'}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-baseline justify-between px-1">
              <p className="font-heavy text-body-sm text-ink">{side === 'buy' ? 'Amount to buy' : 'Amount to sell'}</p>
              <p className="tabular font-strong text-amount-sm text-ink">
                {sellAll ? formatNaira(kobo(stockValueForQuantity(held, quote.priceMinor))) : `₦${entryDisplay(entry)}`}
              </p>
            </div>
            <p className="mt-1 px-1 font-body text-label-sm text-slate">
              {quantity > 0 ? `About ${formatShares(quantity)} shares` : 'Enter an amount'}
              {side === 'sell' && held > 0 ? ` · you hold ${formatShares(held)}` : ''}
            </p>

            {side === 'sell' && held > 0 ? (
              <button
                type="button"
                onClick={() => setSellAll((v) => !v)}
                className="mt-2 px-1 font-strong text-label-sm text-indigo"
              >
                {sellAll ? 'Choose an amount' : 'Sell all'}
              </button>
            ) : null}

            <div className="mt-3">
              <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
            </div>

            {problem ? <p className="mt-3 text-center font-body text-label-sm text-halt">{problem}</p> : null}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
                className="flex h-14 flex-1 items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
              >
                {busy ? 'Working' : side === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
