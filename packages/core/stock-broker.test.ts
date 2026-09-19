import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StockPosition } from './schemas';
import {
  applyStockTrade,
  buyStock,
  formatShares,
  getQuote,
  listPositions,
  searchTicker,
  sellStock,
  stockQuantityForAmount,
  stockValueForQuantity,
} from './stock-broker';

const CONFIG = { apiKeyId: 'key-id', apiSecretKey: 'secret' };

const AAPL = { symbol: 'AAPL', companyName: 'Apple Inc.' };

function held(quantityScaled: number, costBasisMinor: number, priceMinor: number): StockPosition[] {
  return [
    {
      ...AAPL,
      quantityScaled,
      costBasisMinor,
      currentValueMinor: stockValueForQuantity(quantityScaled, priceMinor),
    },
  ];
}

describe('share arithmetic', () => {
  it('rounds the share count DOWN so it never spends more than entered', () => {
    // ₦1,000.00 at ₦300,000.00/share = 0.0033 shares (0.00333… floored)
    expect(stockQuantityForAmount(100_000, 30_000_000)).toBe(33);
    expect(stockQuantityForAmount(30_000_000, 30_000_000)).toBe(10_000);
  });

  it('returns 0 for an unusable price', () => {
    expect(stockQuantityForAmount(100_000, 0)).toBe(0);
  });

  it('values a quantity at a price in whole minor units', () => {
    expect(stockValueForQuantity(25_000, 30_000_000)).toBe(75_000_000);
    expect(Number.isInteger(stockValueForQuantity(33, 30_000_000))).toBe(true);
  });

  it('formats share counts without trailing zeros', () => {
    expect(formatShares(25_000)).toBe('2.5');
    expect(formatShares(10_000)).toBe('1');
    expect(formatShares(125)).toBe('0.0125');
  });
});

describe('applyStockTrade', () => {
  it('opens a position on a first buy', () => {
    const next = applyStockTrade([], AAPL, 10_000, 30_000_000);
    expect(next).toEqual([
      { ...AAPL, quantityScaled: 10_000, costBasisMinor: 30_000_000, currentValueMinor: 30_000_000 },
    ]);
  });

  it('adds to an existing position and its cost basis', () => {
    const next = applyStockTrade(held(10_000, 30_000_000, 30_000_000), AAPL, 5_000, 32_000_000);
    expect(next[0]).toMatchObject({ quantityScaled: 15_000, costBasisMinor: 46_000_000 });
  });

  it('removes cost basis in proportion on a partial sell', () => {
    const next = applyStockTrade(held(20_000, 60_000_000, 30_000_000), AAPL, -5_000, 30_000_000);
    expect(next[0]).toMatchObject({ quantityScaled: 15_000, costBasisMinor: 45_000_000 });
  });

  it('drops the position when it is sold down to zero', () => {
    expect(applyStockTrade(held(10_000, 30_000_000, 30_000_000), AAPL, -10_000, 30_000_000)).toEqual([]);
  });

  it('refuses to sell more than is held', () => {
    expect(() => applyStockTrade(held(10_000, 30_000_000, 30_000_000), AAPL, -10_001, 30_000_000)).toThrow();
    expect(() => applyStockTrade([], AAPL, -1, 30_000_000)).toThrow();
  });
});

describe('stock-broker gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws "not configured" for every call without credentials, and never touches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(searchTicker('apple')).rejects.toThrow('Stocks is not configured');
    await expect(getQuote('AAPL')).rejects.toThrow('Stocks is not configured');
    await expect(buyStock('AAPL', 10_000)).rejects.toThrow('Stocks is not configured');
    await expect(sellStock('AAPL', 10_000)).rejects.toThrow('Stocks is not configured');
    await expect(listPositions()).rejects.toThrow('Stocks is not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters the asset list client-side, tradable only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { symbol: 'AAPL', name: 'Apple Inc.', tradable: true },
          { symbol: 'APLE', name: 'Apple Hospitality REIT', tradable: false },
          { symbol: 'MSFT', name: 'Microsoft Corporation', tradable: true },
        ],
      }),
    );
    const results = await searchTicker('apple', CONFIG);
    expect(results.map((r) => r.symbol)).toEqual(['AAPL']);
  });

  it('turns a live quote into a mid price in cents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ symbol: 'AAPL', quote: { t: '2026-09-19T10:00:00Z', bp: 189.9, ap: 190.1 } }),
      }),
    );
    const quote = await getQuote('AAPL', CONFIG);
    expect(quote).toEqual({ symbol: 'AAPL', midPriceCents: 19_000, asOf: '2026-09-19T10:00:00Z' });
  });

  it('sends the share count as a decimal string and parses the fill', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'order-1',
        symbol: 'AAPL',
        filled_qty: '2.5',
        filled_avg_price: '190.05',
        status: 'filled',
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const order = await buyStock('AAPL', 25_000, CONFIG);

    expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as { body: string }).body)).toMatchObject({
      symbol: 'AAPL',
      qty: '2.5',
      side: 'buy',
    });
    expect(order).toEqual({
      orderId: 'order-1',
      symbol: 'AAPL',
      filledQuantityScaled: 25_000,
      filledPriceCents: 19_005,
      status: 'filled',
    });
  });

  it('rejects a malformed order response instead of trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: '' }) }));
    await expect(sellStock('AAPL', 10_000, CONFIG)).rejects.toThrow();
  });

  it('lists positions with company names, falling back to the symbol when the name lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/v2/positions')) {
          return {
            ok: true,
            json: async () => [
              { symbol: 'AAPL', qty: '2.5', cost_basis: '450.00', market_value: '475.13' },
              { symbol: 'MSFT', qty: '1', cost_basis: '400.00', market_value: '410.00' },
            ],
          };
        }
        if (url.endsWith('/v2/assets/AAPL')) return { ok: true, json: async () => ({ name: 'Apple Inc.' }) };
        return { ok: false, json: async () => ({}) };
      }),
    );

    const positions = await listPositions(CONFIG);

    expect(positions).toEqual([
      { symbol: 'AAPL', companyName: 'Apple Inc.', quantityScaled: 25_000, costBasisCents: 45_000, marketValueCents: 47_513 },
      { symbol: 'MSFT', companyName: 'MSFT', quantityScaled: 10_000, costBasisCents: 40_000, marketValueCents: 41_000 },
    ]);
  });
});
