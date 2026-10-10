'use client';

import { ChevronRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import type { StockSearchResult } from '@entole/core/gateway';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';
import { formatShares } from '@entole/core/stock-broker';

import { Header } from '@/components/Header';
import { StockCatalogue } from '@/components/StockCatalogue';

/**
 * Stocks. Until a broker is connected this is a place to look: every stock
 * that will be buyable, with its live price (`StockCatalogue`), and no
 * holdings and no way to buy. With a broker it is holdings and a search into
 * the buy flow. Mirrors `apps/mobile/app/grow/stocks.tsx`.
 */
export default function StocksPage() {
  const store = useStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setProblem(null);
    try {
      setResults(await store.searchStocks(query));
    } catch {
      setResults(null);
      setProblem('Search did not go through. Try again in a moment.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Stocks" back="/grow" />

      <div className="flex-1 px-gutter pb-28">
        {!store.stocksAvailable ? (
          <>
            <p className="px-1 pb-4 text-pretty font-body text-body-sm text-slate">
              Look through the companies and funds you will be able to own a piece of. Buying opens soon.
            </p>
            <StockCatalogue />
          </>
        ) : (
          <>
            <h2 className="px-1 pb-3 font-heavy text-body-sm text-ink">Holdings</h2>
            {store.stockPositions.length === 0 ? (
              <p className="px-1 font-body text-body-sm text-slate">You do not hold any shares yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {store.stockPositions.map((position) => (
                  <Link
                    key={position.symbol}
                    href={`/grow/stocks/${encodeURIComponent(position.symbol)}`}
                    aria-label={`${position.companyName}, ${formatShares(position.quantityScaled)} shares`}
                    className="flex items-center justify-between rounded-control border border-line bg-card px-4 py-3.5 hover:border-mist"
                  >
                    <div className="flex-1 pr-3">
                      <p className="font-strong text-body-sm text-ink">{position.companyName}</p>
                      <p className="mt-0.5 font-body text-label-sm text-slate">
                        {position.symbol} · {formatShares(position.quantityScaled)} shares
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="tabular font-strong text-body-sm text-ink">
                        {formatNaira(kobo(position.currentValueMinor))}
                      </span>
                      <ChevronRight size={16} strokeWidth={1.5} className="text-mist" />
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <h2 className="px-1 pb-3 pt-6 font-heavy text-body-sm text-ink">Buy stock</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
              className="flex items-center gap-2.5 rounded-control border border-line bg-card px-4 py-3.5"
            >
              <Search size={18} strokeWidth={1.5} className="text-mist" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a company or symbol"
                aria-label="Search stocks"
                autoCapitalize="none"
                autoCorrect="off"
                className="flex-1 bg-transparent font-body text-body text-ink outline-none placeholder:text-mist"
              />
            </form>

            {problem ? <p className="mt-3 px-1 font-body text-label-sm text-halt">{problem}</p> : null}

            {searching ? (
              <p className="mt-3 px-1 font-body text-label-sm text-slate">Searching</p>
            ) : results ? (
              results.length === 0 ? (
                <p className="mt-3 px-1 font-body text-body-sm text-slate">No matches.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {results.map((result) => (
                    <Link
                      key={result.symbol}
                      href={`/grow/stocks/${encodeURIComponent(result.symbol)}`}
                      aria-label={`Buy ${result.name}`}
                      className="flex items-center justify-between rounded-control border border-line bg-card px-4 py-3.5 hover:border-mist"
                    >
                      <div className="flex-1 pr-3">
                        <p className="font-strong text-body-sm text-ink">{result.name}</p>
                        <p className="mt-0.5 font-body text-label-sm text-slate">{result.symbol}</p>
                      </div>
                      <ChevronRight size={16} strokeWidth={1.5} className="text-mist" />
                    </Link>
                  ))}
                </div>
              )
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
