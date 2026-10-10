import { describe, expect, it, vi } from 'vitest';

import {
  StockMarketUnavailableError,
  createStockMarketClient,
  fetchExchangeTable,
  fetchIssuedShares,
  fetchStockDetail,
  formatBig,
  formatChange,
  formatUsd,
  joinStockList,
  pageStockList,
  parseBps,
  parseCents,
  parseCount,
  plainCompanyName,
  refreshStockPrices,
  type StockListItem,
} from './stock-market';

/**
 * The bodies below are cut down from what the issuer and the exchange really
 * answered on 10 October 2026. They are here to pin the shapes this code
 * reads, not to stand in for a price: nothing in the app reads a figure from
 * anywhere but the live sources.
 */
const issuerAsset = (symbol: string, underlying: string, extra: Record<string, unknown> = {}) => ({
  id: symbol,
  name: `${underlying} xStock`,
  symbol,
  underlyingSymbol: underlying,
  logo: `https://xstocks-metadata.backed.fi/logos/tokens/${symbol}.png`,
  isTradingHalted: false,
  trading: { openNow: false, nextChangeAt: '2026-10-12T00:00:00.000Z' },
  deployments: [{ network: 'Solana' }, { network: 'Monad', address: '0x1' }],
  ...extra,
});

const COMPANIES = {
  data: {
    rows: [
      { symbol: 'AAPL', name: 'Apple Inc. Common Stock', lastsale: '$340.42', pctchange: '1.11%', volume: '51000000', marketCap: '4970000000000.00', sector: 'Technology' },
      { symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock', lastsale: '$230.48', pctchange: '-2.944%', volume: '118700296', marketCap: '5554568000000.00', sector: 'Technology' },
      { symbol: 'TSLA', name: 'Tesla Inc. Common Stock', lastsale: '$410.10', pctchange: '0.5%', volume: '90000000', marketCap: '1300000000000.00', sector: 'Consumer Discretionary' },
      { symbol: 'BRKN', name: 'Broken Row', lastsale: 'N/A', pctchange: '--', volume: '', marketCap: '' },
    ],
  },
};
const FUNDS = {
  data: {
    data: {
      rows: [
        { symbol: 'SPY', companyName: 'State Street SPDR S&P 500 ETF Trust Unit', lastSalePrice: '$778.5700', percentageChange: '-0.42510304549507066%' },
      ],
    },
  },
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('reading the exchange’s strings', () => {
  it('turns its money, percentages and counts into whole numbers', () => {
    expect(parseCents('$229.28')).toBe(22_928);
    expect(parseCents('$778.5700')).toBe(77_857);
    expect(parseCents('N/A')).toBeUndefined();
    expect(parseBps('-0.52%')).toBe(-52);
    expect(parseBps('+0.60%')).toBe(60);
    expect(parseBps('-0.42510304549507066%')).toBe(-43);
    expect(parseBps('--')).toBeUndefined();
    expect(parseCount('84,647,475')).toBe(84_647_475);
    expect(parseCount('5554568000000.00')).toBe(5_554_568_000_000);
    expect(parseCount('')).toBeUndefined();
  });

  it('drops the share-class wording from a company name', () => {
    expect(plainCompanyName('NVIDIA Corporation Common Stock')).toBe('NVIDIA Corporation');
    expect(plainCompanyName('Alphabet Inc. Class A Common Stock')).toBe('Alphabet Inc.');
    expect(plainCompanyName('Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares')).toBe(
      'Taiwan Semiconductor Manufacturing Company Ltd.',
    );
  });
});

describe('fetchIssuedShares', () => {
  it('keeps what is on Monad and not halted, across pages, keyed by the real share', async () => {
    const pages = [
      { nodes: [issuerAsset('NVDAx', 'NVDA'), issuerAsset('HALTx', 'HALT', { isTradingHalted: true })], page: { hasNextPage: true } },
      { nodes: [issuerAsset('AAPLx', 'AAPL'), issuerAsset('ELSEx', 'ELSE', { deployments: [{ network: 'Solana' }] })], page: { hasNextPage: false } },
    ];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      return reply(pages[page] ?? { nodes: [], page: { hasNextPage: false } });
    });
    const shares = await fetchIssuedShares(fetchImpl as unknown as typeof fetch);
    expect(shares.map((share) => share.symbol).sort()).toEqual(['AAPL', 'NVDA']);
    expect(shares.find((share) => share.symbol === 'NVDA')).toEqual({
      symbol: 'NVDA',
      issuerName: 'NVDA xStock',
      logo: 'https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png',
      marketOpen: false,
      marketChangesAt: '2026-10-12T00:00:00.000Z',
    });
  });

  it('says the list cannot be loaded, and never makes one up', async () => {
    for (const fetchImpl of [
      vi.fn(async () => reply({}, 503)),
      vi.fn(async () => reply({ unexpected: true })),
      vi.fn(async () => reply({ nodes: [], page: { hasNextPage: false } })),
      vi.fn(async () => {
        throw new Error('offline');
      }),
    ]) {
      await expect(fetchIssuedShares(fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(
        StockMarketUnavailableError,
      );
    }
  });
});

describe('fetchExchangeTable', () => {
  const both = () =>
    vi.fn(async (url: string | URL | Request) => reply(String(url).includes('/screener/etf') ? FUNDS : COMPANIES));

  it('reads companies and funds, skipping any row without a real price', async () => {
    const table = await fetchExchangeTable(both() as unknown as typeof fetch);
    expect([...table.keys()].sort()).toEqual(['AAPL', 'NVDA', 'SPY', 'TSLA']);
    expect(table.get('NVDA')).toEqual({
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      kind: 'company',
      priceCents: 23_048,
      changeBps: -294,
      volume: 118_700_296,
      marketCap: 5_554_568_000_000,
      sector: 'Technology',
    });
    expect(table.get('SPY')).toEqual({
      symbol: 'SPY',
      name: 'State Street SPDR S&P 500 ETF Trust Unit',
      kind: 'fund',
      priceCents: 77_857,
      changeBps: -43,
    });
  });

  it('still answers with companies when the funds table cannot be read', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/screener/etf') ? reply({}, 500) : reply(COMPANIES),
    );
    const table = await fetchExchangeTable(fetchImpl as unknown as typeof fetch);
    expect(table.has('NVDA')).toBe(true);
    expect(table.has('SPY')).toBe(false);
  });

  it('refuses when the exchange gives no prices at all', async () => {
    const fetchImpl = vi.fn(async () => reply({ data: { rows: [] } }));
    await expect(fetchExchangeTable(fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(
      StockMarketUnavailableError,
    );
  });
});

describe('asking a source', () => {
  const page = { nodes: [issuerAsset('NVDAx', 'NVDA')], page: { hasNextPage: false } };

  it('tries once more when the connection drops, and then answers', async () => {
    let calls = 0;
    const flaky = vi.fn(async (_url: string | URL | Request) => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(page), { status: 200 });
    });
    const shares = await fetchIssuedShares(flaky as unknown as typeof fetch);
    expect(shares.map((share) => share.symbol)).toEqual(['NVDA']);
  });

  it('does not ask again for an answer it was refused', async () => {
    const refused = vi.fn(async (_url: string | URL | Request) => new Response('{}', { status: 403 }));
    await expect(fetchExchangeTable(refused as unknown as typeof fetch)).rejects.toBeInstanceOf(StockMarketUnavailableError);
    // One request for companies and one for funds, no repeats.
    expect(refused.mock.calls.length).toBe(2);
  });

  it('gives up when the connection keeps dropping', async () => {
    const down = vi.fn(async (_url: string | URL | Request): Promise<Response> => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchIssuedShares(down as unknown as typeof fetch)).rejects.toBeInstanceOf(StockMarketUnavailableError);
  });
});

describe('the list people browse', () => {
  const shares = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'NOPE'].map((symbol) => ({
    symbol,
    issuerName: `${symbol} xStock`,
    logo: `https://logos.test/${symbol}.png`,
    marketOpen: false,
  }));

  async function list(): Promise<StockListItem[]> {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      reply(String(url).includes('/screener/etf') ? FUNDS : COMPANIES),
    );
    return joinStockList(shares, await fetchExchangeTable(fetchImpl as unknown as typeof fetch));
  }

  it('lists only what both sources know, biggest company first, funds after', async () => {
    const items = await list();
    expect(items.map((item) => item.symbol)).toEqual(['NVDA', 'AAPL', 'TSLA', 'SPY']);
    expect(items[0]!.logo).toBe('https://logos.test/NVDA.png');
  });

  it('finds by the start of a symbol or of a word in the name, and pages', async () => {
    const items = await list();
    expect(pageStockList(items, { query: 'tes' }).items.map((item) => item.symbol)).toEqual(['TSLA']);
    expect(pageStockList(items, { query: 'corp' }).items.map((item) => item.symbol)).toEqual(['NVDA']);
    expect(pageStockList(items, { query: 'vid' }).total).toBe(0);
    expect(pageStockList(items, { kind: 'fund' }).items.map((item) => item.symbol)).toEqual(['SPY']);
    expect(pageStockList(items, { offset: 1, limit: 2 })).toMatchObject({ total: 4 });
    expect(pageStockList(items, { offset: 1, limit: 2 }).items.map((item) => item.symbol)).toEqual(['AAPL', 'TSLA']);
  });
});

describe('refreshStockPrices', () => {
  const listed = (symbol: string, kind: 'company' | 'fund' = 'company'): StockListItem => ({
    symbol,
    name: symbol,
    kind,
    priceCents: 23_048,
    changeBps: -294,
    volume: 118_700_296,
    marketCap: 5_554_568_000_000,
  });
  const answer = (rows: unknown[]) => vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ data: rows })));

  it('asks for the whole page in one request and takes the newer figures', async () => {
    const quotes = answer([
      { symbol: 'NVDA', lastSalePrice: '$229.28', percentageChange: '-0.52%', volume: '84,647,475' },
      { symbol: 'SPY', lastSalePrice: '$778.57', percentageChange: '+0.60%', volume: '22,625,607' },
    ]);
    const fresh = await refreshStockPrices([listed('NVDA'), listed('SPY', 'fund')], quotes as unknown as typeof fetch);

    expect(quotes).toHaveBeenCalledTimes(1);
    expect(String(quotes.mock.calls[0]![0])).toContain('/quote/watchlist?symbol=nvda%7Cstocks&symbol=spy%7Cetf');
    expect(fresh[0]).toMatchObject({ symbol: 'NVDA', priceCents: 22_928, changeBps: -52, volume: 84_647_475, marketCap: 5_554_568_000_000 });
    expect(fresh[1]).toMatchObject({ symbol: 'SPY', priceCents: 77_857, changeBps: 60 });
  });

  it('leaves a stock as it was when the exchange leaves it out or sends something unreadable', async () => {
    const quotes = answer([{ symbol: 'NVDA', lastSalePrice: 'N/A', percentageChange: '' }]);
    const fresh = await refreshStockPrices([listed('NVDA'), listed('AAPL')], quotes as unknown as typeof fetch);
    expect(fresh).toEqual([listed('NVDA'), listed('AAPL')]);
  });

  it('asks nothing for an empty page, and fails loudly when the exchange cannot be reached', async () => {
    const quotes = answer([]);
    expect(await refreshStockPrices([], quotes as unknown as typeof fetch)).toEqual([]);
    expect(quotes).not.toHaveBeenCalled();

    const refused = vi.fn(async (_url: string | URL | Request) => new Response('{}', { status: 403 }));
    await expect(refreshStockPrices([listed('NVDA')], refused as unknown as typeof fetch)).rejects.toBeInstanceOf(
      StockMarketUnavailableError,
    );
  });
});

describe('fetchStockDetail', () => {
  const item: StockListItem = { symbol: 'NVDA', name: 'NVIDIA Corporation', kind: 'company', priceCents: 23_048, changeBps: -294 };
  const market = { marketOpen: false, marketChangesAt: '2026-10-12T00:00:00.000Z' };

  const INFO = {
    data: {
      exchange: 'NASDAQ-GS',
      primaryData: { lastSalePrice: '$229.28', percentageChange: '-0.52%', lastTradeTimestamp: 'Oct 8, 2026', volume: '84,647,475' },
    },
  };
  const SUMMARY = {
    data: {
      summaryData: {
        AverageVolume: { value: '119,191,820' },
        PreviousClose: { value: '$230.48' },
        FiftTwoWeekHighLow: { value: '$243.37/$164.27' },
        MarketCap: { value: '5,525,648,000,000' },
        Yield: { value: '0.43%' },
      },
    },
  };
  const HISTORY = {
    data: {
      tradesTable: {
        rows: [
          { date: '10/09/2026', close: '$229.28' },
          { date: '10/08/2026', close: '$230.48' },
          { date: '09/08/2026', close: '$225.73' },
        ],
      },
    },
  };
  const PROFILE = { data: { CompanyDescription: { value: 'NVIDIA (NASDAQ: NVDA) is the world leader in AI and accelerated computing.' } } };

  function exchange(overrides: Partial<Record<'info' | 'summary' | 'historical' | 'profile', unknown | number>> = {}) {
    return vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const key = target.includes('/info') ? 'info' : target.includes('/summary') ? 'summary' : target.includes('/historical') ? 'historical' : 'profile';
      const body = { info: INFO, summary: SUMMARY, historical: HISTORY, profile: PROFILE }[key];
      const override = overrides[key];
      return typeof override === 'number' ? reply({}, override) : reply(override ?? body);
    });
  }

  it('gathers the price, the day, the range, the history and a line about the company', async () => {
    const fetchImpl = exchange();
    const detail = await fetchStockDetail(item, market, {
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-10-10T08:00:00.000Z'),
    });
    expect(detail).toMatchObject({
      symbol: 'NVDA',
      priceCents: 22_928,
      changeBps: -52,
      asOf: '2026-10-09',
      exchange: 'NASDAQ-GS',
      volume: 84_647_475,
      averageVolume: 119_191_820,
      marketCap: 5_525_648_000_000,
      previousCloseCents: 23_048,
      yearLowCents: 16_427,
      yearHighCents: 24_337,
      dividendYieldBps: 43,
      marketOpen: false,
      marketChangesAt: '2026-10-12T00:00:00.000Z',
    });
    expect(detail.history).toEqual([
      { date: '2026-09-08', closeCents: 22_573 },
      { date: '2026-10-08', closeCents: 23_048 },
      { date: '2026-10-09', closeCents: 22_928 },
    ]);
    expect(detail.about).toMatch(/accelerated computing/);
    const asked = fetchImpl.mock.calls.map(([url]) => String(url)).find((url) => url.includes('/historical'))!;
    expect(asked).toContain('fromdate=2026-09-05');
    expect(asked).toContain('todate=2026-10-10');
  });

  it('shows less, not something invented, when the extras cannot be read', async () => {
    const detail = await fetchStockDetail(item, market, {
      fetch: exchange({ summary: 500, historical: 500, profile: 500 }) as unknown as typeof fetch,
    });
    expect(detail.priceCents).toBe(22_928);
    expect(detail.history).toEqual([]);
    expect(detail.about).toBeUndefined();
    expect(detail.yearLowCents).toBeUndefined();
    expect(detail.asOf).toBe('Oct 8, 2026');
  });

  it('refuses outright without a real price', async () => {
    await expect(
      fetchStockDetail(item, market, { fetch: exchange({ info: 500 }) as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(StockMarketUnavailableError);
    const noPrice = { data: { primaryData: { lastSalePrice: 'N/A', percentageChange: 'N/A' } } };
    await expect(
      fetchStockDetail(item, market, { fetch: exchange({ info: noPrice }) as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(StockMarketUnavailableError);
  });

  it('asks about a fund as a fund, and for no company profile', async () => {
    const fetchImpl = exchange();
    await fetchStockDetail({ ...item, symbol: 'SPY', kind: 'fund' }, market, { fetch: fetchImpl as unknown as typeof fetch });
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => !url.includes('company-profile'))).toBe(true);
    expect(urls.find((url) => url.includes('/info'))).toContain('assetclass=etf');
  });
});

describe('for screens', () => {
  it('writes money, changes and big numbers the way a person reads them', () => {
    expect(formatUsd(22_928)).toBe('$229.28');
    expect(formatUsd(123_456_705)).toBe('$1,234,567.05');
    expect(formatChange(-52)).toBe('−0.52%');
    expect(formatChange(60)).toBe('+0.60%');
    expect(formatChange(0)).toBe('0.00%');
    expect(formatBig(84_647_475)).toBe('84.6 million');
    expect(formatBig(5_525_648_000_000)).toBe('5.53 trillion');
    expect(formatBig(119_191_820)).toBe('119 million');
    expect(formatBig(950)).toBe('950');
  });
});

describe('the client both apps use', () => {
  const row = { symbol: 'NVDA', name: 'NVIDIA Corporation', kind: 'company', priceCents: 22_928, changeBps: -52 };

  it('asks our own server, and parses what comes back', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => reply({ items: [row], total: 1 }));
    const client = createStockMarketClient({ baseUrl: 'https://x.test/', fetch: fetchImpl as unknown as typeof fetch });
    expect(await client.list({ kind: 'company', query: ' nv ', offset: 30 })).toEqual({ items: [row], total: 1 });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://x.test/api/stocks?kind=company&q=nv&offset=30');
  });

  it('refuses an answer of the wrong shape or a bad status', async () => {
    const wrong = createStockMarketClient({ baseUrl: 'https://x.test', fetch: (async () => reply({ items: [{ symbol: 'X' }] })) as unknown as typeof fetch });
    await expect(wrong.list()).rejects.toBeInstanceOf(StockMarketUnavailableError);
    const down = createStockMarketClient({ baseUrl: 'https://x.test', fetch: (async () => reply({}, 502)) as unknown as typeof fetch });
    await expect(down.detail('NVDA')).rejects.toThrow(/can't load that one/);
  });
});
