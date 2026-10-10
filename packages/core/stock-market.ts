import { z } from 'zod';

/**
 * What people will be able to buy, shown before they can buy it.
 *
 * Two live sources, joined, and nothing written in by hand:
 *
 * 1. **The issuer's own list** (Backed, `api.backed.fi`): every share that
 *    exists in a form an Entole account could hold on Monad, with its name,
 *    its mark, and whether its market is open.
 * 2. **The exchange's public data** (Nasdaq, `api.nasdaq.com`): the price, the
 *    day's change, how much was traded, what the company is worth, a month of
 *    closes and a line about what the company does.
 *
 * A share is listed only when both know it. The order is the exchange's own
 * figure for what each company is worth, so the best-known names come first
 * without anyone choosing them. If a source cannot be reached, the answer is
 * that it cannot be reached: there is no fallback list and no stored price.
 *
 * One thing is taken away and nothing is added: a share named after a coin is
 * left off (see `speaksOfCoins`).
 *
 * Nothing here can buy anything. Buying needs the issuer's approval and is
 * not open (see docs/BACKLOG.md).
 *
 * The exchange's endpoints are the ones its own website uses. They are not a
 * product it offers to others, so they may change or refuse a server; that is
 * why every answer is parsed, and why a failure is reported and never papered
 * over.
 */

export const ISSUER_API_BASE = 'https://api.backed.fi/api/v2/public';
export const EXCHANGE_API_BASE = 'https://api.nasdaq.com/api';

/** The network a share has to exist on for an Entole account to hold it. */
const HOME_NETWORK = /^monad$/i;

/**
 * Words that name a coin or the world around one. Entole is money as people
 * already know it, so a share named after a coin is not listed, and what a
 * company says about itself is left out when it speaks of them.
 */
const COIN_TALK =
  /\b(bitcoins?|btc|ether|ethereum|solana|xrp|crypto\w*|blockchains?|defi|web3|\w+coins?|digital assets?|token\w*)\b/i;

/** True for "2x Bitcoin ETF". False for "Coeur Mining Inc." and "Block Inc.". */
export function speaksOfCoins(text: string): boolean {
  return COIN_TALK.test(text);
}

export class StockMarketUnavailableError extends Error {
  constructor(what: 'list' | 'prices' | 'stock') {
    super(
      what === 'stock'
        ? "We can't load that one right now. Try again in a moment."
        : "We can't load stocks right now. Try again in a moment.",
    );
    this.name = 'StockMarketUnavailableError';
  }
}

/** A company, or a fund that holds many. */
export const stockKindSchema = z.enum(['company', 'fund']);
export type StockKind = z.infer<typeof stockKindSchema>;

/** One row of the list. Money is whole cents; a change is hundredths of a percent. */
export const stockListItemSchema = z.object({
  /** The market's own symbol for it. Shown small; the name leads. */
  symbol: z.string().min(1),
  name: z.string().min(1),
  kind: stockKindSchema,
  /** https only. */
  logo: z.string().url().optional(),
  priceCents: z.number().int().positive(),
  changeBps: z.number().int(),
  /** Shares traded in the last full day. Not known for funds. */
  volume: z.number().int().nonnegative().optional(),
  /** What the whole company is worth, in dollars. Not known for funds. */
  marketCap: z.number().nonnegative().optional(),
  sector: z.string().optional(),
});
export type StockListItem = z.infer<typeof stockListItemSchema>;

export const stockListSchema = z.object({
  items: z.array(stockListItemSchema),
  /** How many match in all, of which `items` is one page. */
  total: z.number().int().nonnegative(),
});
export type StockList = z.infer<typeof stockListSchema>;

export const stockDetailSchema = stockListItemSchema.extend({
  exchange: z.string().optional(),
  /** The day the price is from: "2026-10-09" when known exactly, otherwise as
   * the exchange words it ("Oct 9, 2026"). */
  asOf: z.string().optional(),
  previousCloseCents: z.number().int().positive().optional(),
  averageVolume: z.number().int().nonnegative().optional(),
  yearLowCents: z.number().int().positive().optional(),
  yearHighCents: z.number().int().positive().optional(),
  /** Yearly dividend as a share of the price, in hundredths of a percent. */
  dividendYieldBps: z.number().int().nonnegative().optional(),
  /** A sentence or two from the company's own listing. */
  about: z.string().optional(),
  /** Daily closes, oldest first. Empty when the exchange gave none. */
  history: z.array(z.object({ date: z.string(), closeCents: z.number().int().positive() })),
  /** Whether the market for it is open right now, and when that changes. */
  marketOpen: z.boolean(),
  marketChangesAt: z.string().optional(),
});
export type StockDetail = z.infer<typeof stockDetailSchema>;

// ---------------------------------------------------------------------------
// Reading the exchange's strings. It sends "$229.28", "-0.52%", "84,647,475".

/** "$229.28" or "229.2800" to 22928. `undefined` for "N/A" or anything else. */
export function parseCents(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return Math.round(Number(text) * 100);
}

/** "-0.52%" or "+0.60%" or "-2.944%" to hundredths of a percent. */
export function parseBps(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).replace(/[%,\s+]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return Math.round(Number(text) * 100);
}

/** "84,647,475" or "5554568000000.00" to a whole number. */
export function parseCount(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  return Math.round(Number(text));
}

/** "NVIDIA Corporation Common Stock" reads as "NVIDIA Corporation". */
export function plainCompanyName(name: string): string {
  const cleaned = name
    .replace(/\s+(Class [A-Z]\b.*|Common Stock.*|Common Shares.*|Ordinary Shares.*|American Depositary Shares.*|Depositary Shares.*|Capital Stock.*)$/i, '')
    .replace(/\s+\(.*\)$/, '')
    .trim();
  return cleaned.length >= 2 ? cleaned : name.trim();
}

// ---------------------------------------------------------------------------
// Asking a source.

/** No single request may hold a screen up for longer than this. */
const SOURCE_TIMEOUT_MS = 12_000;

/**
 * One request to a source, given up on after `SOURCE_TIMEOUT_MS` and tried
 * once more if the connection itself failed: a single dropped connection among
 * a dozen should not empty the screen. An answer, good or bad, is never asked
 * for twice.
 */
async function ask(fetchImpl: typeof fetch, url: string, headers: Record<string, string>): Promise<Response> {
  const once = async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SOURCE_TIMEOUT_MS);
    try {
      return await fetchImpl(url, { headers, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await once();
  } catch {
    return once();
  }
}

// ---------------------------------------------------------------------------
// The issuer's list.

const issuerAssetSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  logo: z.string().optional().nullable(),
  isTradingHalted: z.boolean().optional(),
  trading: z
    .object({ openNow: z.boolean().optional(), nextChangeAt: z.string().optional().nullable() })
    .partial()
    .optional()
    .nullable(),
  deployments: z.array(z.object({ network: z.string() }).passthrough()).optional(),
});
const issuerPageSchema = z.object({
  nodes: z.array(z.unknown()),
  page: z.object({ hasNextPage: z.boolean() }).partial().optional(),
});

/** One share the issuer has made holdable on Monad and has not halted. */
export type IssuedShare = {
  /** The market's symbol for the real share behind it. */
  symbol: string;
  issuerName: string;
  logo?: string;
  marketOpen: boolean;
  marketChangesAt?: string;
};

/** The issuer pages its list; this is far more pages than it has, as a stop. */
const MAX_ISSUER_PAGES = 40;

/** How many pages are asked for at once. The list is about fourteen pages long. */
const ISSUER_PAGES_AT_ONCE = 6;

export async function fetchIssuedShares(fetchImpl: typeof fetch = fetch): Promise<IssuedShare[]> {
  const shares = new Map<string, IssuedShare>();

  async function readPage(page: number): Promise<boolean> {
    const response = await ask(fetchImpl, `${ISSUER_API_BASE}/assets?page=${page}`, { accept: 'application/json' });
    if (!response.ok) throw new StockMarketUnavailableError('list');
    const parsed = issuerPageSchema.safeParse(await response.json());
    if (!parsed.success) throw new StockMarketUnavailableError('list');

    for (const node of parsed.data.nodes) {
      const asset = issuerAssetSchema.safeParse(node);
      // One odd entry is skipped; it does not take the list down with it.
      if (!asset.success || asset.data.isTradingHalted) continue;
      if (!asset.data.deployments?.some((deployment) => HOME_NETWORK.test(deployment.network))) continue;
      const logo = asset.data.logo && /^https:\/\//.test(asset.data.logo) ? asset.data.logo : undefined;
      const changesAt = asset.data.trading?.nextChangeAt ?? undefined;
      shares.set(asset.data.underlyingSymbol, {
        symbol: asset.data.underlyingSymbol,
        issuerName: asset.data.name,
        ...(logo ? { logo } : {}),
        marketOpen: asset.data.trading?.openNow === true,
        ...(changesAt ? { marketChangesAt: changesAt } : {}),
      });
    }
    return parsed.data.page?.hasNextPage === true && parsed.data.nodes.length > 0;
  }

  try {
    // A few pages at a time, stopping at the first batch that reaches the end.
    for (let first = 0; first < MAX_ISSUER_PAGES; first += ISSUER_PAGES_AT_ONCE) {
      const more = await Promise.all(
        Array.from({ length: ISSUER_PAGES_AT_ONCE }, (_unused, index) => readPage(first + index)),
      );
      if (more.some((hasNext) => !hasNext)) break;
    }
  } catch (error) {
    if (error instanceof StockMarketUnavailableError) throw error;
    throw new StockMarketUnavailableError('list');
  }
  if (shares.size === 0) throw new StockMarketUnavailableError('list');
  return [...shares.values()];
}

// ---------------------------------------------------------------------------
// The exchange's figures.

/** The exchange refuses requests that do not look like its own website's. */
const EXCHANGE_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://www.nasdaq.com',
  referer: 'https://www.nasdaq.com/',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

async function exchangeJson(path: string, fetchImpl: typeof fetch, failure: 'prices' | 'stock'): Promise<unknown> {
  try {
    const response = await ask(fetchImpl, `${EXCHANGE_API_BASE}${path}`, EXCHANGE_HEADERS);
    if (!response.ok) throw new StockMarketUnavailableError(failure);
    return await response.json();
  } catch (error) {
    if (error instanceof StockMarketUnavailableError) throw error;
    throw new StockMarketUnavailableError(failure);
  }
}

const companyRowSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  lastsale: z.unknown(),
  pctchange: z.unknown(),
  volume: z.unknown(),
  marketCap: z.unknown(),
  sector: z.string().optional().nullable(),
});
const fundRowSchema = z.object({
  symbol: z.string().min(1),
  companyName: z.string().min(1),
  lastSalePrice: z.unknown(),
  percentageChange: z.unknown(),
});
const rowsAt = (body: unknown, ...path: string[]): unknown[] => {
  let cursor: unknown = body;
  for (const key of path) cursor = (cursor as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(cursor) ? cursor : [];
};

type Priced = Omit<StockListItem, 'logo'>;

/** Every company and every fund the exchange prices, in two requests. */
export async function fetchExchangeTable(fetchImpl: typeof fetch = fetch): Promise<Map<string, Priced>> {
  const [companies, funds] = await Promise.all([
    exchangeJson('/screener/stocks?tableonly=true&download=true', fetchImpl, 'prices'),
    // Funds are a second table. Without it the companies are still true.
    exchangeJson('/screener/etf?download=true', fetchImpl, 'prices').catch(() => null),
  ]);

  const table = new Map<string, Priced>();
  for (const raw of rowsAt(companies, 'data', 'rows')) {
    const row = companyRowSchema.safeParse(raw);
    if (!row.success) continue;
    const priceCents = parseCents(row.data.lastsale);
    const changeBps = parseBps(row.data.pctchange);
    if (!priceCents || priceCents <= 0 || changeBps === undefined) continue;
    const volume = parseCount(row.data.volume);
    const marketCap = parseCount(row.data.marketCap);
    const sector = row.data.sector?.trim();
    table.set(row.data.symbol, {
      symbol: row.data.symbol,
      name: plainCompanyName(row.data.name),
      kind: 'company',
      priceCents,
      changeBps,
      ...(volume !== undefined ? { volume } : {}),
      ...(marketCap ? { marketCap } : {}),
      ...(sector ? { sector } : {}),
    });
  }
  if (table.size === 0) throw new StockMarketUnavailableError('prices');

  const fundRows = [...rowsAt(funds, 'data', 'data', 'rows'), ...rowsAt(funds, 'data', 'rows')];
  for (const raw of fundRows) {
    const row = fundRowSchema.safeParse(raw);
    if (!row.success || table.has(row.data.symbol)) continue;
    const priceCents = parseCents(row.data.lastSalePrice);
    const changeBps = parseBps(row.data.percentageChange);
    if (!priceCents || priceCents <= 0 || changeBps === undefined) continue;
    table.set(row.data.symbol, {
      symbol: row.data.symbol,
      name: plainCompanyName(row.data.companyName),
      kind: 'fund',
      priceCents,
      changeBps,
    });
  }
  return table;
}

const quoteRowSchema = z.object({
  symbol: z.string().min(1),
  lastSalePrice: z.unknown(),
  percentageChange: z.unknown(),
  volume: z.unknown().optional(),
});

/**
 * The latest price for a handful of stocks, in one request. The exchange's
 * full table can sit a trading day behind its own quotes, so a page of the
 * list is brought up to date with this before it is shown, and then agrees
 * with what opening a stock says. A stock the exchange leaves out of its
 * answer keeps the figures it had.
 */
export async function refreshStockPrices(
  items: StockListItem[],
  fetchImpl: typeof fetch = fetch,
): Promise<StockListItem[]> {
  if (items.length === 0) return items;
  const asked = items
    .map((item) => `symbol=${encodeURIComponent(`${item.symbol.toLowerCase()}|${item.kind === 'fund' ? 'etf' : 'stocks'}`)}`)
    .join('&');
  const body = await exchangeJson(`/quote/watchlist?${asked}`, fetchImpl, 'prices');

  const latest = new Map<string, Pick<StockListItem, 'priceCents' | 'changeBps' | 'volume'>>();
  for (const row of rowsAt(body, 'data')) {
    const quote = quoteRowSchema.safeParse(row);
    if (!quote.success) continue;
    const priceCents = parseCents(quote.data.lastSalePrice);
    const changeBps = parseBps(quote.data.percentageChange);
    if (!priceCents || priceCents <= 0 || changeBps === undefined) continue;
    const volume = parseCount(quote.data.volume);
    latest.set(quote.data.symbol.toUpperCase(), { priceCents, changeBps, ...(volume !== undefined ? { volume } : {}) });
  }
  return items.map((item) => ({ ...item, ...latest.get(item.symbol) }));
}

/**
 * The list people browse: every share the issuer has on Monad that the
 * exchange can price, less any named after a coin. Companies first, largest
 * first by the exchange's own figure for what each is worth; then funds by
 * name.
 */
export function joinStockList(shares: IssuedShare[], table: Map<string, Priced>): StockListItem[] {
  const items: StockListItem[] = [];
  for (const share of shares) {
    const priced = table.get(share.symbol);
    if (!priced || speaksOfCoins(priced.name)) continue;
    items.push({ ...priced, ...(share.logo ? { logo: share.logo } : {}) });
  }
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'company' ? -1 : 1;
    if (a.kind === 'company') return (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

/** Narrows the list to a kind and to what was typed, then takes one page. */
export function pageStockList(
  items: StockListItem[],
  options: { kind?: StockKind; query?: string; offset?: number; limit?: number },
): StockList {
  const needle = options.query?.trim().toLowerCase() ?? '';
  const matches = items.filter((item) => {
    if (options.kind && item.kind !== options.kind) return false;
    if (!needle) return true;
    // The start of the symbol, or the start of any word in the name: "tes"
    // finds Tesla, not every name with those letters somewhere inside it.
    if (item.symbol.toLowerCase().startsWith(needle)) return true;
    const name = item.name.toLowerCase();
    return name.startsWith(needle) || name.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle));
  });
  // Someone who types a symbol exactly wants that one first.
  if (needle) matches.sort((a, b) => Number(b.symbol.toLowerCase() === needle) - Number(a.symbol.toLowerCase() === needle));
  const offset = Math.max(0, options.offset ?? 0);
  return { items: matches.slice(offset, offset + (options.limit ?? 30)), total: matches.length };
}

const infoSchema = z.object({
  data: z.object({
    exchange: z.string().optional().nullable(),
    primaryData: z.object({
      lastSalePrice: z.unknown(),
      percentageChange: z.unknown(),
      lastTradeTimestamp: z.string().optional().nullable(),
      volume: z.unknown().optional(),
    }),
  }),
});
const summaryValue = (body: unknown, key: string): unknown =>
  (((body as { data?: { summaryData?: Record<string, { value?: unknown }> } } | null)?.data?.summaryData ?? {})[key] ?? {})
    .value;

/** "10/09/2026" to "2026-10-09". */
function isoDay(usDate: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(usDate.trim());
  return match ? `${match[3]}-${match[1]}-${match[2]}` : undefined;
}

/**
 * Everything shown about one share. The price and the day's change must be
 * there or the whole thing is refused; the rest is each included only if the
 * exchange gave it, and a screen shows only what is included. What a company
 * says about itself is left out when it speaks of coins.
 */
export async function fetchStockDetail(
  item: StockListItem,
  share: Pick<IssuedShare, 'marketOpen' | 'marketChangesAt'>,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<StockDetail> {
  const fetchImpl = options.fetch ?? fetch;
  const assetClass = item.kind === 'fund' ? 'etf' : 'stocks';
  const symbol = encodeURIComponent(item.symbol);
  const today = (options.now ?? (() => new Date()))();
  const from = new Date(today.getTime() - 35 * 86_400_000);
  const day = (date: Date) => date.toISOString().slice(0, 10);

  const optional = (path: string) => exchangeJson(path, fetchImpl, 'stock').catch(() => null);
  const [info, summary, history, profile] = await Promise.all([
    exchangeJson(`/quote/${symbol}/info?assetclass=${assetClass}`, fetchImpl, 'stock'),
    optional(`/quote/${symbol}/summary?assetclass=${assetClass}`),
    optional(`/quote/${symbol}/historical?assetclass=${assetClass}&fromdate=${day(from)}&todate=${day(today)}&limit=40`),
    item.kind === 'company' ? optional(`/company/${symbol}/company-profile`) : Promise.resolve(null),
  ]);

  const parsed = infoSchema.safeParse(info);
  if (!parsed.success) throw new StockMarketUnavailableError('stock');
  const primary = parsed.data.data.primaryData;
  const priceCents = parseCents(primary.lastSalePrice);
  const changeBps = parseBps(primary.percentageChange);
  if (!priceCents || priceCents <= 0 || changeBps === undefined) throw new StockMarketUnavailableError('stock');

  const range = String(summaryValue(summary, 'FiftTwoWeekHighLow') ?? '').split('/');
  const closes = rowsAt(history, 'data', 'tradesTable', 'rows')
    .map((row) => {
      const entry = row as { date?: unknown; close?: unknown };
      const date = typeof entry.date === 'string' ? isoDay(entry.date) : undefined;
      const closeCents = parseCents(entry.close);
      return date && closeCents && closeCents > 0 ? { date, closeCents } : null;
    })
    .filter((entry): entry is { date: string; closeCents: number } => entry !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const about = (profile as { data?: { CompanyDescription?: { value?: unknown } } } | null)?.data?.CompanyDescription?.value;
  const volume = parseCount(primary.volume) ?? parseCount(summaryValue(summary, 'ShareVolume')) ?? item.volume;
  const marketCap = parseCount(summaryValue(summary, 'MarketCap')) ?? item.marketCap;
  const previousCloseCents = parseCents(summaryValue(summary, 'PreviousClose'));
  const averageVolume = parseCount(summaryValue(summary, 'AverageVolume'));
  const yearHighCents = parseCents(range[0]);
  const yearLowCents = parseCents(range[1]);
  const dividendYieldBps = parseBps(summaryValue(summary, 'Yield'));
  const exchange = parsed.data.data.exchange?.trim();
  // The day the price is from: the last close when the history has it (and it
  // is that price), otherwise the exchange's own wording.
  const lastClose = closes[closes.length - 1];
  const asOf = lastClose && lastClose.closeCents === priceCents ? lastClose.date : primary.lastTradeTimestamp?.trim();

  return stockDetailSchema.parse({
    ...item,
    priceCents,
    changeBps,
    ...(volume !== undefined ? { volume } : {}),
    ...(marketCap ? { marketCap } : {}),
    ...(exchange ? { exchange } : {}),
    ...(asOf ? { asOf } : {}),
    ...(previousCloseCents ? { previousCloseCents } : {}),
    ...(averageVolume ? { averageVolume } : {}),
    ...(yearLowCents && yearHighCents && yearLowCents <= yearHighCents ? { yearLowCents, yearHighCents } : {}),
    ...(dividendYieldBps ? { dividendYieldBps } : {}),
    ...(typeof about === 'string' && about.trim().length > 20 && !speaksOfCoins(about) ? { about: about.trim() } : {}),
    history: closes,
    marketOpen: share.marketOpen,
    ...(share.marketChangesAt ? { marketChangesAt: share.marketChangesAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// For screens.

/** 22928 to "$229.28". */
export function formatUsd(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '−' : ''}$${whole}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

/** -52 to "−0.52%", 60 to "+0.60%". */
export function formatChange(bps: number): string {
  const sign = bps > 0 ? '+' : bps < 0 ? '−' : '';
  return `${sign}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

/** 84647475 to "84.6 million", 5525648000000 to "5.53 trillion". Words, not letters. */
export function formatBig(value: number): string {
  const steps: [number, string][] = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ];
  for (const [size, word] of steps) {
    if (value >= size) {
      const scaled = value / size;
      return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${word}`;
    }
  }
  return String(Math.round(value));
}

/** The client both apps use. Every answer is parsed before a screen sees it. */
export function createStockMarketClient(options: { baseUrl: string; fetch?: typeof fetch }) {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function get<T>(path: string, schema: z.ZodType<T>, failure: 'list' | 'stock'): Promise<T> {
    try {
      const response = await fetchImpl(`${base}${path}`);
      if (!response.ok) throw new StockMarketUnavailableError(failure);
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new StockMarketUnavailableError(failure);
      return parsed.data;
    } catch (error) {
      if (error instanceof StockMarketUnavailableError) throw error;
      throw new StockMarketUnavailableError(failure);
    }
  }

  return {
    list(query: { kind?: StockKind; query?: string; offset?: number } = {}): Promise<StockList> {
      const params = new URLSearchParams();
      if (query.kind) params.set('kind', query.kind);
      if (query.query?.trim()) params.set('q', query.query.trim());
      if (query.offset) params.set('offset', String(query.offset));
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return get(`/api/stocks${suffix}`, stockListSchema, 'list');
    },
    detail(symbol: string): Promise<StockDetail> {
      return get(`/api/stocks/${encodeURIComponent(symbol)}`, stockDetailSchema, 'stock');
    },
  };
}

export type StockMarketClient = ReturnType<typeof createStockMarketClient>;
