import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadStocks, resetStocks } from '@/lib/server/stocks';

/**
 * The stocks list is kept where every server instance can reach it, so one
 * that has just started does not make its first visitor wait for both sources.
 * Here that shared store is a variable, and "a new server" is `resetStocks()`,
 * which empties everything an instance holds in memory.
 */
const kept = vi.hoisted(() => ({ value: null as { at: number } | null }));

vi.mock('next/cache', () => ({
  unstable_cache: (read: () => Promise<{ at: number }>) => async () => {
    kept.value ??= await read();
    return kept.value;
  },
}));

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ISSUER = {
  nodes: [
    {
      name: 'NVDA xStock',
      symbol: 'NVDAx',
      underlyingSymbol: 'NVDA',
      isTradingHalted: false,
      trading: { openNow: false, nextChangeAt: '2026-10-12T00:00:00.000Z' },
      deployments: [{ network: 'Monad' }],
    },
  ],
  page: { hasNextPage: false },
};
const COMPANIES = {
  data: {
    rows: [{ symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock', lastsale: '$230.48', pctchange: '-2.944%', volume: '118700296', marketCap: '5554568000000.00', sector: 'Technology' }],
  },
};

let sourcesDown = false;
const upstream = vi.fn(async (url: string | URL | Request) => {
  if (sourcesDown) return reply({}, 503);
  const target = String(url);
  if (target.includes('api.backed.fi')) return reply(ISSUER);
  if (target.includes('/screener/stocks')) return reply(COMPANIES);
  return reply({ data: { data: { rows: [] } } });
});

beforeEach(() => {
  kept.value = null;
  sourcesDown = false;
  resetStocks();
  upstream.mockClear();
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => vi.unstubAllGlobals());

describe('the stocks list, kept across servers', () => {
  it('a server that has just started takes the kept list and asks neither source', async () => {
    const first = await loadStocks();
    expect(first.items.map((item) => item.symbol)).toEqual(['NVDA']);
    const asked = upstream.mock.calls.length;
    expect(asked).toBeGreaterThan(0);

    resetStocks();
    sourcesDown = true;
    const second = await loadStocks();
    expect(second.items.map((item) => item.symbol)).toEqual(['NVDA']);
    expect(second.shares.get('NVDA')?.marketOpen).toBe(false);
    expect(upstream.mock.calls.length).toBe(asked);
  });

  it('a kept list older than an hour is not trusted: the sources are asked again', async () => {
    await loadStocks();
    const asked = upstream.mock.calls.length;
    kept.value!.at = Date.now() - 61 * 60 * 1000;

    resetStocks();
    const fresh = await loadStocks();
    expect(upstream.mock.calls.length).toBeGreaterThan(asked);
    expect(Date.now() - fresh.at).toBeLessThan(60_000);
  });

  it('and when they cannot be reached then, it fails rather than show the old list', async () => {
    await loadStocks();
    kept.value!.at = Date.now() - 61 * 60 * 1000;

    resetStocks();
    sourcesDown = true;
    await expect(loadStocks()).rejects.toThrow();
  });
});
