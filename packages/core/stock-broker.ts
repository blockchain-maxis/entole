import { z } from 'zod';

import type { StockPosition } from './schemas';

/**
 * Stocks — the Grow hub's second product, alongside the growth-vault
 * Savings position. No bounty claims this one; it exists because the user
 * asked for it directly ("buy a stock" as a Grow product, expand on the
 * idea).
 *
 * Confirmed real, against live docs.alpaca.markets (not guessed): Alpaca's
 * Trading API — auth via `APCA-API-KEY-ID`/`APCA-API-SECRET-KEY` headers,
 * trading host `https://paper-api.alpaca.markets` (paper) or
 * `https://api.alpaca.markets` (live), market data host
 * `https://data.alpaca.markets`. `POST /v2/orders` takes
 * `{ symbol, qty: string, side, type: "market", time_in_force: "day" }` and
 * returns `{ id, symbol, filled_qty, filled_avg_price, status, ... }` —
 * `filled_qty`/`filled_avg_price` are decimal STRINGS, not numbers.
 * `GET /v2/stocks/{symbol}/quotes/latest` returns
 * `{ symbol, quote: { t, bp, bs, ap, as, ... } }` — `bp`/`ap` are bid/ask
 * price as numbers (dollars, not cents). `GET /v2/assets` supports only
 * `status`/`asset_class`/`exchange`/`attributes` filters — **no
 * server-side search/query param exists**, so ticker "search" here filters
 * the fetched active-asset list client-side by symbol/name substring; a
 * paginated first call (`status=active&asset_class=us_equity`) is
 * reasonable for this use case, not a full universe fetch every keystroke.
 * All of the above verified via `docs.alpaca.markets/reference/postorder`,
 * `.../stocklatestquotesingle-1`, `.../get-v2-assets-1` directly, same
 * rigor `settlement-asset.ts` (Agora) applied — this is a fully-confirmed
 * interface, not a best-effort one. Still gated off until a real API key
 * exists: never place a fake order, never show a fake quote.
 */

export type StockBrokerConfig = {
  apiKeyId: string;
  apiSecretKey: string;
  /** Defaults to Alpaca's paper-trading host — swapping to
   * `https://api.alpaca.markets` for live trading is a one-config-value
   * change, not a code change. */
  tradingBase?: string;
  dataBase?: string;
};

const assetSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  tradable: z.boolean(),
});

const quoteResponseSchema = z.object({
  symbol: z.string().min(1),
  quote: z.object({
    t: z.string(),
    bp: z.number().nonnegative(),
    ap: z.number().nonnegative(),
  }),
});

// `GET /v2/positions` — every numeric field is a decimal STRING (confirmed
// against docs.alpaca.markets/reference/getallopenpositions).
const positionResponseSchema = z.object({
  symbol: z.string().min(1),
  qty: z.string(),
  cost_basis: z.string(),
  market_value: z.string(),
});

const assetNameSchema = z.object({ name: z.string().min(1) });

const orderResponseSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  filled_qty: z.string(),
  filled_avg_price: z.string().nullable(),
  status: z.string(),
});

export type TickerResult = z.infer<typeof assetSchema>;

export type Quote = {
  symbol: string;
  /** Mid of bid/ask, in the settlement currency's minor units — naira-minor
   * conversion is the caller's job (`onchain-gateway.ts`), same boundary
   * every other money value in this codebase crosses. Alpaca quotes in
   * dollars; this stays in dollars-as-minor (cents) — the caller converts
   * via the same `fx.ts` rate everything else uses. */
  midPriceCents: number;
  asOf: string;
};

export type OrderResult = {
  orderId: string;
  symbol: string;
  /** Fixed-point, 4 decimal places — mirrors `stockPositionSchema`'s
   * `quantityScaled`. Alpaca returns a decimal string; this is that string
   * parsed and scaled, never a raw float carried through money math. */
  filledQuantityScaled: number;
  filledPriceCents: number | null;
  status: string;
};

function requireBrokerConfig(config: StockBrokerConfig | undefined): StockBrokerConfig {
  if (!config?.apiKeyId || !config.apiSecretKey) {
    throw new Error(
      'Stocks is not configured — set an Alpaca API key/secret (ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY) ' +
        'to enable it.',
    );
  }
  return config;
}

function authHeaders(config: StockBrokerConfig): Record<string, string> {
  return {
    'APCA-API-KEY-ID': config.apiKeyId,
    'APCA-API-SECRET-KEY': config.apiSecretKey,
    'Content-Type': 'application/json',
  };
}

/** Fixed-point share count (4 decimal places) — see `stockPositionSchema`. */
export const SHARE_SCALE = 10_000;

function toShareString(quantityScaled: number): string {
  return (quantityScaled / SHARE_SCALE).toString();
}

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** "2.5" / "10" / "0.0125" — a share count without trailing zeros. */
export function formatShares(quantityScaled: number): string {
  return Number((quantityScaled / SHARE_SCALE).toFixed(4)).toString();
}

/**
 * How many shares (fixed-point, 4 decimals) `amountMinor` buys at
 * `priceMinor` per share, rounded DOWN — never spend more than the amount
 * entered. Both inputs are in the same minor unit, so the ratio is unit-free.
 * Returns 0 when the amount is too small to buy 0.0001 of a share.
 */
export function stockQuantityForAmount(amountMinor: number, priceMinor: number): number {
  if (priceMinor <= 0) return 0;
  return Math.floor((amountMinor * SHARE_SCALE) / priceMinor);
}

/** What `quantityScaled` shares are worth at `priceMinor` per share, rounded
 * to the nearest minor unit. */
export function stockValueForQuantity(quantityScaled: number, priceMinor: number): number {
  return Math.round((quantityScaled * priceMinor) / SHARE_SCALE);
}

/**
 * Applies a buy (`deltaScaled > 0`) or sell (`< 0`) at `priceMinor` to a
 * positions list and returns the new list. Cost basis moves with the trade
 * on the buy side; a sell removes cost basis in proportion to the shares
 * sold (average-cost), and a position sold down to zero disappears. Throws
 * rather than going negative.
 */
export function applyStockTrade(
  positions: StockPosition[],
  stock: { symbol: string; companyName: string },
  deltaScaled: number,
  priceMinor: number,
): StockPosition[] {
  const existing = positions.find((p) => p.symbol === stock.symbol);
  const held = existing?.quantityScaled ?? 0;
  const next = held + deltaScaled;
  if (next < 0) throw new Error(`Cannot sell more ${stock.symbol} than is held`);

  const others = positions.filter((p) => p.symbol !== stock.symbol);
  if (next === 0) return others;

  const costBasisMinor =
    deltaScaled > 0
      ? (existing?.costBasisMinor ?? 0) + stockValueForQuantity(deltaScaled, priceMinor)
      : Math.round(((existing?.costBasisMinor ?? 0) * next) / held);

  return [
    ...others,
    {
      symbol: stock.symbol,
      companyName: existing?.companyName ?? stock.companyName,
      quantityScaled: next,
      costBasisMinor,
      currentValueMinor: stockValueForQuantity(next, priceMinor),
    },
  ];
}

/** Ticker lookup by symbol/name substring. Alpaca has no server-side search
 * param (confirmed against live docs — see this file's header), so this
 * fetches the active-asset list and filters client-side. Every response is
 * Zod-validated before use. */
export async function searchTicker(query: string, config?: StockBrokerConfig): Promise<TickerResult[]> {
  const resolved = requireBrokerConfig(config);
  const base = resolved.tradingBase ?? 'https://paper-api.alpaca.markets';
  const response = await fetch(`${base}/v2/assets?status=active&asset_class=us_equity`, {
    headers: authHeaders(resolved),
  });
  if (!response.ok) throw new Error(`Stock search failed: ${response.status}`);
  const body: unknown = await response.json();
  const assets = z.array(assetSchema).parse(body);
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return assets
    .filter((a) => a.tradable && (a.symbol.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)))
    .slice(0, 20);
}

/** Latest quote for a symbol. */
export async function getQuote(symbol: string, config?: StockBrokerConfig): Promise<Quote> {
  const resolved = requireBrokerConfig(config);
  const base = resolved.dataBase ?? 'https://data.alpaca.markets';
  const response = await fetch(`${base}/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`, {
    headers: authHeaders(resolved),
  });
  if (!response.ok) throw new Error(`Quote request failed for ${symbol}: ${response.status}`);
  const body: unknown = await response.json();
  const parsed = quoteResponseSchema.parse(body);
  const mid = (parsed.quote.bp + parsed.quote.ap) / 2;
  return { symbol: parsed.symbol, midPriceCents: toCents(mid), asOf: parsed.quote.t };
}

async function placeOrder(
  symbol: string,
  quantityScaled: number,
  side: 'buy' | 'sell',
  config: StockBrokerConfig,
): Promise<OrderResult> {
  const base = config.tradingBase ?? 'https://paper-api.alpaca.markets';
  const response = await fetch(`${base}/v2/orders`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({
      symbol,
      qty: toShareString(quantityScaled),
      side,
      type: 'market',
      time_in_force: 'day',
    }),
  });
  if (!response.ok) throw new Error(`${side === 'buy' ? 'Buy' : 'Sell'} order failed for ${symbol}: ${response.status}`);
  const body: unknown = await response.json();
  const parsed = orderResponseSchema.parse(body);
  return {
    orderId: parsed.id,
    symbol: parsed.symbol,
    filledQuantityScaled: Math.round(Number(parsed.filled_qty) * SHARE_SCALE),
    filledPriceCents: parsed.filled_avg_price ? toCents(Number(parsed.filled_avg_price)) : null,
    status: parsed.status,
  };
}

/** Places a real market buy order. Resolves only once Alpaca reports the
 * order's state — no interim optimistic state, same promise `submitPayment`
 * makes. */
export async function buyStock(
  symbol: string,
  quantityScaled: number,
  config?: StockBrokerConfig,
): Promise<OrderResult> {
  return placeOrder(symbol, quantityScaled, 'buy', requireBrokerConfig(config));
}

/** Places a real market sell order — mirrors `buyStock` exactly. */
export async function sellStock(
  symbol: string,
  quantityScaled: number,
  config?: StockBrokerConfig,
): Promise<OrderResult> {
  return placeOrder(symbol, quantityScaled, 'sell', requireBrokerConfig(config));
}

export type BrokerPosition = {
  symbol: string;
  /** Alpaca's positions payload carries no company name; it's looked up per
   * symbol from `GET /v2/assets/{symbol}`, falling back to the symbol itself
   * if that lookup fails (never an invented name). */
  companyName: string;
  quantityScaled: number;
  costBasisCents: number;
  marketValueCents: number;
};

/** The account's open positions, Zod-validated. Dollar amounts stay in cents;
 * converting to the account's own currency is the caller's job, same as
 * `getQuote`. */
export async function listPositions(config?: StockBrokerConfig): Promise<BrokerPosition[]> {
  const resolved = requireBrokerConfig(config);
  const base = resolved.tradingBase ?? 'https://paper-api.alpaca.markets';
  const response = await fetch(`${base}/v2/positions`, { headers: authHeaders(resolved) });
  if (!response.ok) throw new Error(`Holdings request failed: ${response.status}`);
  const body: unknown = await response.json();
  const positions = z.array(positionResponseSchema).parse(body);

  return Promise.all(
    positions.map(async (p): Promise<BrokerPosition> => {
      let companyName = p.symbol;
      try {
        const assetResponse = await fetch(`${base}/v2/assets/${encodeURIComponent(p.symbol)}`, {
          headers: authHeaders(resolved),
        });
        if (assetResponse.ok) companyName = assetNameSchema.parse(await assetResponse.json()).name;
      } catch {
        // keep the symbol as the display name
      }
      return {
        symbol: p.symbol,
        companyName,
        quantityScaled: Math.round(Number(p.qty) * SHARE_SCALE),
        costBasisCents: toCents(Number(p.cost_basis)),
        marketValueCents: toCents(Number(p.market_value)),
      };
    }),
  );
}
