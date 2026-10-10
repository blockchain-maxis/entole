import { unstable_cache } from 'next/cache';

import {
  StockMarketUnavailableError,
  fetchExchangeTable,
  fetchIssuedShares,
  fetchStockDetail,
  joinStockList,
  refreshStockPrices,
  type IssuedShare,
  type StockDetail,
  type StockListItem,
} from '@entole/core/stock-market';

/**
 * The stocks list and each stock's details, read from their live sources and
 * kept for a short while so that browsing does not ask the issuer and the
 * exchange for the same thing on every tap.
 *
 * What is kept is only ever what a source actually answered. If a refresh
 * fails, the last answer is served for up to an hour and then refused: there
 * is no list to fall back on and no price that did not come from the exchange.
 */

/** The exchange's table moves once a day; ten minutes is plenty. */
const LIST_FRESH_MS = 10 * 60 * 1000;
/** How long the last good list may stand in while a source is down. */
const LIST_STALE_LIMIT_MS = 60 * 60 * 1000;
const DETAIL_FRESH_MS = 60 * 1000;
/** Details are kept per stock; this stops the store growing without end. */
const DETAIL_LIMIT = 300;
/** How long a refreshed price stands before the exchange is asked again. */
const PRICE_FRESH_MS = 5 * 60 * 1000;
const PRICE_LIMIT = 2000;

type Loaded = { at: number; items: StockListItem[]; shares: Map<string, IssuedShare> };

let list: Loaded | null = null;
let listInFlight: Promise<Loaded> | null = null;
const details = new Map<string, { at: number; detail: StockDetail }>();
const prices = new Map<string, { at: number; latest: Pick<StockListItem, 'priceCents' | 'changeBps' | 'volume'> }>();

type Read = { at: number; items: StockListItem[]; shares: IssuedShare[] };

/** Both sources, read now. Throws when either cannot be reached. */
async function readSources(): Promise<Read> {
  const [shares, table] = await Promise.all([fetchIssuedShares(), fetchExchangeTable()]);
  const items = joinStockList(shares, table);
  const listed = new Set(items.map((item) => item.symbol));
  return { at: Date.now(), items, shares: shares.filter((share) => listed.has(share.symbol)) };
}

/**
 * The same read, kept where every server instance can reach it. Reading both
 * sources in full takes several seconds; without this, each server that has
 * just started makes its first visitor wait for all of it. Prices do not go
 * stale here: a page's prices are asked for again before it is sent.
 *
 * (`unstable_cache` is how this Next version keeps a value across instances
 * without moving the whole app to Cache Components.)
 */
const readShared = unstable_cache(readSources, ['stocks-list'], { revalidate: LIST_FRESH_MS / 1000 });

async function refreshList(): Promise<Loaded> {
  let read: Read;
  try {
    read = await readShared();
    // A kept answer is handed back while it is refreshed. If refreshing keeps
    // failing it must not stand for ever: past the limit, ask the sources.
    if (Date.now() - read.at >= LIST_STALE_LIMIT_MS) read = await readSources();
  } catch (error) {
    if (error instanceof StockMarketUnavailableError) throw error;
    // Nowhere shared to keep it (outside a deployed server): read directly.
    read = await readSources();
  }
  const loaded: Loaded = {
    at: read.at,
    items: read.items,
    shares: new Map(read.shares.map((share) => [share.symbol, share])),
  };
  list = loaded;
  return loaded;
}

export async function loadStocks(): Promise<Loaded> {
  if (list && Date.now() - list.at < LIST_FRESH_MS) return list;
  listInFlight ??= refreshList().finally(() => {
    listInFlight = null;
  });
  try {
    return await listInFlight;
  } catch (error) {
    if (list && Date.now() - list.at < LIST_STALE_LIMIT_MS) return list;
    throw error;
  }
}

/**
 * One page of the list, with each price as the exchange quotes it now. The
 * exchange's full table can sit a trading day behind its own quotes, so the
 * few stocks about to be shown are asked for again, together. If that cannot
 * be read the table's figures stand: a day older, and still the exchange's.
 */
export async function withLatestPrices(items: StockListItem[]): Promise<StockListItem[]> {
  const now = Date.now();
  const wanted = items.filter((item) => {
    const kept = prices.get(item.symbol);
    return !kept || now - kept.at >= PRICE_FRESH_MS;
  });
  if (wanted.length > 0) {
    try {
      const fresh = await refreshStockPrices(wanted);
      if (prices.size + fresh.length > PRICE_LIMIT) prices.clear();
      for (const { symbol, priceCents, changeBps, volume } of fresh) {
        prices.set(symbol, { at: now, latest: { priceCents, changeBps, ...(volume !== undefined ? { volume } : {}) } });
      }
    } catch {
      // Nothing newer to show.
    }
  }
  return items.map((item) => ({ ...item, ...prices.get(item.symbol)?.latest }));
}

/** `null` when it is not a stock on the list. Throws when it cannot be read. */
export async function loadStockDetail(symbol: string): Promise<StockDetail | null> {
  const wanted = symbol.trim().toUpperCase();
  const cached = details.get(wanted);
  if (cached && Date.now() - cached.at < DETAIL_FRESH_MS) return cached.detail;

  const { items, shares } = await loadStocks();
  const item = items.find((entry) => entry.symbol === wanted);
  const share = shares.get(wanted);
  if (!item || !share) return null;

  const detail = await fetchStockDetail(item, share);
  if (details.size >= DETAIL_LIMIT) details.clear();
  details.set(wanted, { at: Date.now(), detail });
  return detail;
}

/** For tests. */
export function resetStocks(): void {
  list = null;
  listInFlight = null;
  details.clear();
  prices.clear();
}
