import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as stockDetail } from '@/app/api/stocks/[symbol]/route';
import { GET as stockList } from '@/app/api/stocks/route';
import { resetRateLimits } from '@/lib/server/sponsor';
import { resetStocks } from '@/lib/server/stocks';

/**
 * The stocks routes, with the issuer and the exchange replaced by a stubbed
 * `fetch`: no network. They answer only with what those two said, share an
 * answer for a few minutes instead of asking again, and turn a source being
 * down into a plain 502 rather than an older or invented list.
 */

let ipCounter = 0;
const get = (path: string) =>
  new Request(`https://entole.vercel.app${path}`, { headers: { 'x-forwarded-for': `10.11.0.${++ipCounter}` } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const asset = (underlying: string) => ({
  name: `${underlying} xStock`,
  symbol: `${underlying}x`,
  underlyingSymbol: underlying,
  logo: `https://logos.test/${underlying}.png`,
  isTradingHalted: false,
  trading: { openNow: false, nextChangeAt: '2026-10-12T00:00:00.000Z' },
  deployments: [{ network: 'Monad' }],
});
const ISSUER = { nodes: [asset('NVDA'), asset('AAPL'), asset('SPY'), asset('UNPRICED')], page: { hasNextPage: false } };
const COMPANIES = {
  data: {
    rows: [
      { symbol: 'AAPL', name: 'Apple Inc. Common Stock', lastsale: '$340.42', pctchange: '1.11%', volume: '51000000', marketCap: '4970000000000.00', sector: 'Technology' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock', lastsale: '$230.48', pctchange: '-2.944%', volume: '118700296', marketCap: '5554568000000.00', sector: 'Technology' },
    ],
  },
};
const FUNDS = { data: { data: { rows: [{ symbol: 'SPY', companyName: 'S&P 500 Fund', lastSalePrice: '$778.57', percentageChange: '-0.42%' }] } } };
const INFO = { data: { exchange: 'NASDAQ-GS', primaryData: { lastSalePrice: '$229.28', percentageChange: '-0.52%', lastTradeTimestamp: 'Oct 8, 2026', volume: '84,647,475' } } };

/** The exchange's quote for a few stocks at once: a session newer than its table. */
const QUOTES = { data: [{ symbol: 'NVDA', lastSalePrice: '$229.28', percentageChange: '-0.52%', volume: '84,647,475' }] };

let issuerDown = false;
let exchangeDown = false;
let quotesDown = false;
const upstream = vi.fn(async (url: string | URL | Request) => {
  const target = String(url);
  if (target.includes('api.backed.fi')) return issuerDown ? reply({}, 503) : reply(ISSUER);
  if (exchangeDown) return reply({}, 503);
  if (target.includes('/quote/watchlist')) return quotesDown ? reply({}, 503) : reply(QUOTES);
  if (target.includes('/screener/etf')) return reply(FUNDS);
  if (target.includes('/screener/stocks')) return reply(COMPANIES);
  if (target.includes('/info')) return reply(INFO);
  return reply({ data: {} });
});

beforeEach(() => {
  resetRateLimits();
  resetStocks();
  upstream.mockClear();
  issuerDown = false;
  exchangeDown = false;
  quotesDown = false;
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/stocks', () => {
  it('lists what both sources know, biggest company first, and may be shared for a while', async () => {
    const response = await stockList(get('/api/stocks'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/s-maxage=300/);
    const body = (await response.json()) as { items: { symbol: string; logo?: string }[]; total: number };
    expect(body.items.map((item) => item.symbol)).toEqual(['NVDA', 'AAPL', 'SPY']);
    expect(body.total).toBe(3);
    expect(body.items[0]!.logo).toBe('https://logos.test/NVDA.png');
  });

  it('shows each price as the exchange quotes it now, not as its older table has it', async () => {
    const body = (await (await stockList(get('/api/stocks'))).json()) as { items: { symbol: string; priceCents: number; changeBps: number }[] };
    expect(body.items[0]).toMatchObject({ symbol: 'NVDA', priceCents: 22_928, changeBps: -52 });
    // Not in the quote answer: the table's figure stands.
    expect(body.items[1]).toMatchObject({ symbol: 'AAPL', priceCents: 34_042, changeBps: 111 });
  });

  it('still lists, from the table, when the newer quotes cannot be read', async () => {
    quotesDown = true;
    const response = await stockList(get('/api/stocks'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { symbol: string; priceCents: number }[] };
    expect(body.items[0]).toMatchObject({ symbol: 'NVDA', priceCents: 23_048 });
  });

  it('searches, filters by kind and pages', async () => {
    const found = (await (await stockList(get('/api/stocks?q=app'))).json()) as { items: { symbol: string }[] };
    expect(found.items.map((item) => item.symbol)).toEqual(['AAPL']);
    const funds = (await (await stockList(get('/api/stocks?kind=fund'))).json()) as { items: { symbol: string }[] };
    expect(funds.items.map((item) => item.symbol)).toEqual(['SPY']);
    const second = (await (await stockList(get('/api/stocks?offset=1'))).json()) as { items: { symbol: string }[] };
    expect(second.items.map((item) => item.symbol)).toEqual(['AAPL', 'SPY']);
  });

  it('rejects a kind or an offset that makes no sense', async () => {
    expect((await stockList(get('/api/stocks?kind=coin'))).status).toBe(400);
    expect((await stockList(get('/api/stocks?offset=-1'))).status).toBe(400);
    expect((await stockList(get('/api/stocks?offset=abc'))).status).toBe(400);
  });

  it('asks the sources once, then answers from what they said', async () => {
    await stockList(get('/api/stocks'));
    const asked = upstream.mock.calls.length;
    await stockList(get('/api/stocks?q=nv'));
    await stockList(get('/api/stocks?kind=fund'));
    expect(upstream.mock.calls.length).toBe(asked);
  });

  it('answers 502 when a source is down and nothing was read before', async () => {
    issuerDown = true;
    const response = await stockList(get('/api/stocks'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'unavailable' });

    resetStocks();
    issuerDown = false;
    exchangeDown = true;
    expect((await stockList(get('/api/stocks'))).status).toBe(502);
  });
});

describe('GET /api/stocks/[symbol]', () => {
  const detail = (symbol: string) => stockDetail(get(`/api/stocks/${symbol}`), { params: Promise.resolve({ symbol }) });

  it('answers with the stock as the exchange has it now', async () => {
    const response = await detail('nvda');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/s-maxage=60/);
    expect(await response.json()).toMatchObject({
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      priceCents: 22_928,
      changeBps: -52,
      volume: 84_647_475,
      marketOpen: false,
      history: [],
    });
  });

  it('is 404 for anything not on the list, and 400 for something that is not a symbol', async () => {
    expect((await detail('MSFT')).status).toBe(404);
    expect((await detail('UNPRICED')).status).toBe(404);
    expect((await detail('../etc')).status).toBe(400);
  });

  it('answers 502 when the stock itself cannot be read', async () => {
    await stockList(get('/api/stocks'));
    exchangeDown = true;
    const response = await detail('AAPL');
    expect(response.status).toBe(502);
  });
});
