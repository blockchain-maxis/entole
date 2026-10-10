import { describe, expect, it, vi } from 'vitest';

import {
  createRateProvider,
  DEMO_RATE,
  fetchNairaRate,
  formatRate,
  RateUnavailableError,
  toDollars,
  toNaira,
} from './fx';
import { cents, formatDollars, naira } from './money';

describe('conversion', () => {
  it('matches the amounts shown in the design', () => {
    expect(formatDollars(toDollars(naira(1_284_500), DEMO_RATE))).toBe('$812.97');
    expect(formatDollars(toDollars(naira(120_000), DEMO_RATE))).toBe('$75.95');
    expect(formatDollars(toDollars(naira(50_000), DEMO_RATE))).toBe('$31.65');
  });

  it('stays in integer minor units', () => {
    expect(Number.isInteger(toDollars(naira(1), DEMO_RATE))).toBe(true);
  });

  it('round-trips within a kobo of rounding', () => {
    const there = toDollars(naira(120_000), DEMO_RATE);
    const back = toNaira(there, DEMO_RATE);
    expect(Math.abs(back - naira(120_000))).toBeLessThanOrEqual(100);
  });

  it('converts dollars to naira', () => {
    expect(toNaira(cents(100), DEMO_RATE)).toBe(naira(1_580));
  });
});

describe('formatRate', () => {
  it('reads as a plain sentence of two prices', () => {
    expect(formatRate(DEMO_RATE)).toBe('₦1,580 = $1.00');
  });
});

describe('live rate', () => {
  const body = (ngn: number) => ({ result: 'success', time_last_update_unix: 1_790_000_000, rates: { NGN: ngn } });
  const okFetch = (ngn: number) =>
    (async () => ({ ok: true, json: async () => body(ngn) })) as unknown as typeof fetch;

  it('turns naira-per-dollar into integer kobo per dollar', async () => {
    const rate = await fetchNairaRate(okFetch(1_534.27));
    expect(rate.koboPerDollar).toBe(153_427);
    expect(rate.quotedAt).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it('refuses a malformed response instead of guessing', async () => {
    const bad = (async () => ({ ok: true, json: async () => ({ result: 'error' }) })) as unknown as typeof fetch;
    await expect(fetchNairaRate(bad)).rejects.toBeInstanceOf(RateUnavailableError);
  });

  it('caches for ten minutes, then refetches', async () => {
    let calls = 0;
    let clock = 0;
    const counting = (async () => {
      calls += 1;
      return { ok: true, json: async () => body(1_500 + calls) };
    }) as unknown as typeof fetch;
    const getRate = createRateProvider({ fetch: counting, now: () => clock });
    await getRate();
    await getRate();
    expect(calls).toBe(1);
    clock = 11 * 60 * 1000;
    await getRate();
    expect(calls).toBe(2);
  });

  it('reuses the last good rate when the feed fails, but not forever', async () => {
    let clock = 0;
    let down = false;
    const flaky = (async () => {
      if (down) throw new Error('offline');
      return { ok: true, json: async () => body(1_500) };
    }) as unknown as typeof fetch;
    const getRate = createRateProvider({ fetch: flaky, now: () => clock });
    const first = await getRate();
    down = true;
    clock = 60 * 60 * 1000;
    expect(await getRate()).toEqual(first);
    clock = 25 * 60 * 60 * 1000;
    await expect(getRate()).rejects.toBeInstanceOf(RateUnavailableError);
  });

  it('throws when there has never been a rate, after three tries', async () => {
    let calls = 0;
    const waits: number[] = [];
    const dead = (async () => {
      calls += 1;
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const getRate = createRateProvider({ fetch: dead, sleep: async (ms) => void waits.push(ms) });
    await expect(getRate()).rejects.toBeInstanceOf(RateUnavailableError);
    expect(calls).toBe(3);
    expect(waits).toEqual([400, 1_200]);
  });

  it('gets through a dropped request on a cold start instead of failing the account load', async () => {
    let calls = 0;
    const patchy = (async () => {
      calls += 1;
      if (calls < 3) throw new Error('offline');
      return { ok: true, json: async () => body(1_500) };
    }) as unknown as typeof fetch;
    const rate = await createRateProvider({ fetch: patchy, sleep: async () => undefined })();
    expect(rate.koboPerDollar).toBe(150_000);
    expect(calls).toBe(3);
  });

  it('does not keep anyone waiting for retries when there is a recent rate to use', async () => {
    let clock = 0;
    let calls = 0;
    let down = false;
    const waits: number[] = [];
    const flaky = (async () => {
      calls += 1;
      if (down) throw new Error('offline');
      return { ok: true, json: async () => body(1_500) };
    }) as unknown as typeof fetch;
    const getRate = createRateProvider({ fetch: flaky, now: () => clock, sleep: async (ms) => void waits.push(ms) });
    const first = await getRate();
    down = true;
    clock = 60 * 60 * 1000;
    expect(await getRate()).toEqual(first);
    expect(calls).toBe(2);
    expect(waits).toEqual([]);
  });

  it('shares one request between callers that arrive together', async () => {
    let calls = 0;
    const slow = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, json: async () => body(1_500) };
    }) as unknown as typeof fetch;
    const getRate = createRateProvider({ fetch: slow });
    const [a, b, c] = await Promise.all([getRate(), getRate(), getRate()]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('gives up on a feed that hangs', async () => {
    const hanging = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    vi.useFakeTimers();
    try {
      const pending = expect(fetchNairaRate(hanging)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(8_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
