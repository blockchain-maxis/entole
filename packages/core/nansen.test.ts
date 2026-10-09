import { describe, expect, it, vi } from 'vitest';

import { describeFlows, fetchCorridorFlows, NansenNotConfiguredError } from './nansen';

const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('fetchCorridorFlows', () => {
  it('refuses to run without a key', async () => {
    await expect(fetchCorridorFlows(undefined)).rejects.toBeInstanceOf(NansenNotConfiguredError);
    await expect(fetchCorridorFlows({ apiKey: '' })).rejects.toBeInstanceOf(NansenNotConfiguredError);
  });

  it('sends the key as the apiKey header to the configured path', async () => {
    const fetchImpl = ok({ data: [] });
    await fetchCorridorFlows({ apiKey: 'k', apiBase: 'https://n.test', netflowPath: '/x' }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://n.test/x');
    expect((init.headers as Record<string, string>).apiKey).toBe('k');
  });

  it('rounds to whole dollars and puts the biggest movers first', async () => {
    const summary = await fetchCorridorFlows(
      { apiKey: 'k' },
      ok({
        data: [
          { token_symbol: 'AAA', net_flow_24h_usd: 1200.6 },
          { token_symbol: 'BBB', net_flow_24h_usd: -98000.2 },
        ],
      }),
    );
    expect(summary.flows).toEqual([
      { symbol: 'BBB', netFlow24hUsd: -98000 },
      { symbol: 'AAA', netFlow24hUsd: 1201 },
    ]);
    expect(summary.headline).toMatch(/out of this route/);
  });

  it('fails loudly on a response of the wrong shape or a bad status', async () => {
    await expect(fetchCorridorFlows({ apiKey: 'k' }, ok({ data: [{ token_symbol: 1 }] }))).rejects.toThrow(/unexpected/);
    await expect(fetchCorridorFlows({ apiKey: 'k' }, ok({}, 401))).rejects.toThrow(/401/);
  });
});

describe('describeFlows', () => {
  it('says plainly which way money is moving, without chain or token words', () => {
    const lines = [
      describeFlows([]),
      describeFlows([{ symbol: 'A', netFlow24hUsd: 5 }]),
      describeFlows([{ symbol: 'A', netFlow24hUsd: -5 }]),
    ];
    for (const line of lines) expect(line).not.toMatch(/\b(wallet|crypto|blockchain|chain|gas|token|on-chain)\b/i);
    expect(lines[1]).toMatch(/into this route/);
    expect(lines[2]).toMatch(/out of this route/);
  });
});
