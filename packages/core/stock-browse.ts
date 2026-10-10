import { useCallback, useEffect, useState } from 'react';

import type { StockDetail, StockKind, StockListItem, StockMarketClient } from './stock-market';
import { appendStockPage } from './stock-view';

/**
 * Looking through the stocks, for both apps: the list as it is searched,
 * filtered and paged, and one stock's details. Each is asked for from the
 * server, which reads it from the live sources; nothing is kept here but the
 * last answer, and a failed read is a failed state, never an older figure.
 */

/** How long typing has to pause before the search is sent. */
const SEARCH_SETTLE_MS = 300;

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type LoadedList = { key: string; items: StockListItem[]; total: number; failed: boolean };

export type StockBrowse = {
  state: 'loading' | 'ready' | 'failed';
  items: StockListItem[];
  /** How many match in all, not how many are shown. */
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  loadMore(): void;
  retry(): void;
};

export function useStockBrowse(client: StockMarketClient, filter: { kind?: StockKind; query: string }): StockBrowse {
  const kind = filter.kind;
  const query = useSettled(filter.query.trim(), SEARCH_SETTLE_MS);
  const [attempt, setAttempt] = useState(0);
  const key = `${kind ?? 'all'}|${query}|${attempt}`;
  const [loaded, setLoaded] = useState<LoadedList | null>(null);
  const [more, setMore] = useState<{ key: string; state: 'loading' | 'failed' } | null>(null);

  useEffect(() => {
    let live = true;
    client.list({ ...(kind ? { kind } : {}), query }).then(
      (list) => {
        if (live) setLoaded({ key, items: list.items, total: list.total, failed: false });
      },
      () => {
        if (live) setLoaded({ key, items: [], total: 0, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [client, kind, query, key]);

  // An answer to an earlier question is not an answer to this one.
  const current = loaded?.key === key ? loaded : null;
  const moreState = more?.key === key ? more.state : null;
  const shown = current?.items.length ?? 0;
  const hasMore = current !== null && !current.failed && shown < current.total;

  const loadMore = useCallback(() => {
    if (!hasMore || moreState === 'loading') return;
    setMore({ key, state: 'loading' });
    client.list({ ...(kind ? { kind } : {}), query, offset: shown }).then(
      (list) => {
        setLoaded((now) => {
          if (now?.key !== key) return now;
          const items = appendStockPage(now.items, list.items);
          // A page that adds nothing means there is nothing more to show.
          return { ...now, items, total: items.length === now.items.length ? items.length : list.total };
        });
        setMore((now) => (now?.key === key ? null : now));
      },
      () => setMore((now) => (now?.key === key ? { key, state: 'failed' } : now)),
    );
  }, [client, hasMore, key, kind, moreState, query, shown]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return {
    state: !current ? 'loading' : current.failed ? 'failed' : 'ready',
    items: current?.items ?? [],
    total: current?.total ?? 0,
    hasMore,
    loadingMore: moreState === 'loading',
    moreFailed: moreState === 'failed',
    loadMore,
    retry,
  };
}

export type StockLook = {
  state: 'loading' | 'ready' | 'failed';
  detail: StockDetail | null;
  retry(): void;
};

export function useStockDetail(client: StockMarketClient, symbol: string): StockLook {
  const [attempt, setAttempt] = useState(0);
  const key = `${symbol}|${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; detail: StockDetail | null } | null>(null);

  useEffect(() => {
    let live = true;
    client.detail(symbol).then(
      (detail) => {
        if (live) setLoaded({ key, detail });
      },
      () => {
        if (live) setLoaded({ key, detail: null });
      },
    );
    return () => {
      live = false;
    };
  }, [client, symbol, key]);

  const current = loaded?.key === key ? loaded : null;
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return {
    state: !current ? 'loading' : current.detail ? 'ready' : 'failed',
    detail: current?.detail ?? null,
    retry,
  };
}
