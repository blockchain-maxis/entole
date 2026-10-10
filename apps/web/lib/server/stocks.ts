import {
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

async function refreshList(): Promise<Loaded> {
  const [shares, table] = await Promise.all([fetchIssuedShares(), fetchExchangeTable()]);
  const loaded: Loaded = {
    at: Date.now(),
    items: joinStockList(shares, table),
    shares: new Map(shares.map((share) => [share.symbol, share])),
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
