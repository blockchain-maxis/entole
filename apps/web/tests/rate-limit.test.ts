import { beforeEach, describe, expect, it } from 'vitest';

import { dailyBudget, onTestNetwork, rateLimit, resetRateLimits, sharedLimit, type LimiterRedis } from '@/lib/server/sponsor';

/**
 * The limiter behind every sponsored route. The shared (Redis) window is driven
 * by a fake client, so no network is needed; the in-memory fallback is the one
 * the routes use in dev and tests.
 */

function fakeLimiterRedis() {
  const counts = new Map<string, number>();
  const expiries = new Map<string, number>();
  const redis = {
    incr: async (key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key)!;
    },
    expire: async (key: string, seconds: number) => {
      expiries.set(key, seconds);
      return 1;
    },
    ttl: async (key: string) => expiries.get(key) ?? -1,
  } as unknown as LimiterRedis;
  return { redis, expiries };
}

function request(ip: string) {
  return new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': ip } });
}

beforeEach(() => resetRateLimits());

describe('sharedLimit', () => {
  it('lets calls through up to the limit and then refuses with a retry time', async () => {
    const { redis } = fakeLimiterRedis();
    for (let i = 0; i < 3; i += 1) expect(await sharedLimit(redis, 'k', 3)).toEqual({ ok: true });
    expect(await sharedLimit(redis, 'k', 3)).toEqual({ ok: false, retryAfterSeconds: 60 });
  });

  it('gives the window an expiry on the first hit only, so a key cannot outlive it', async () => {
    const { redis, expiries } = fakeLimiterRedis();
    await sharedLimit(redis, 'k', 5);
    expect(expiries.get('rl:k')).toBe(60);
    expiries.delete('rl:k');
    await sharedLimit(redis, 'k', 5);
    expect(expiries.has('rl:k')).toBe(false);
  });

  it('counts each key on its own', async () => {
    const { redis } = fakeLimiterRedis();
    await sharedLimit(redis, 'a', 1);
    expect(await sharedLimit(redis, 'a', 1)).toMatchObject({ ok: false });
    expect(await sharedLimit(redis, 'b', 1)).toEqual({ ok: true });
  });
});

describe('rateLimit', () => {
  it('limits per caller', async () => {
    expect(await rateLimit(request('1.1.1.1'), 'b', 1)).toEqual({ ok: true });
    expect(await rateLimit(request('1.1.1.1'), 'b', 1)).toMatchObject({ ok: false });
    expect(await rateLimit(request('2.2.2.2'), 'b', 1)).toEqual({ ok: true });
  });

  it('also limits per subject, so changing IP does not lift a cap on one account', async () => {
    const subject = '0xAbC0000000000000000000000000000000000001';
    expect(await rateLimit(request('1.1.1.1'), 'g', 1, subject)).toEqual({ ok: true });
    expect(await rateLimit(request('9.9.9.9'), 'g', 1, subject.toLowerCase())).toMatchObject({ ok: false });
  });
});

describe('dailyBudget', () => {
  const NOON = new Date('2026-10-13T12:00:00.000Z');

  it('lets a day\'s worth through and then refuses until the day is over', async () => {
    for (let i = 0; i < 3; i += 1) expect(await dailyBudget('sends', 3, undefined, NOON)).toEqual({ ok: true });
    // Twelve hours of the day are left.
    expect(await dailyBudget('sends', 3, undefined, NOON)).toEqual({ ok: false, retryAfterSeconds: 43_200 });
  });

  it('starts again the next day', async () => {
    expect(await dailyBudget('sends', 1, undefined, NOON)).toEqual({ ok: true });
    expect((await dailyBudget('sends', 1, undefined, NOON)).ok).toBe(false);
    expect(await dailyBudget('sends', 1, undefined, new Date('2026-10-14T00:00:01.000Z'))).toEqual({ ok: true });
  });

  it('counts each subject on its own, however its address is written', async () => {
    expect(await dailyBudget('each', 1, '0xABCD', NOON)).toEqual({ ok: true });
    expect((await dailyBudget('each', 1, '0xabcd', NOON)).ok).toBe(false);
    expect(await dailyBudget('each', 1, '0xother', NOON)).toEqual({ ok: true });
    // And apart from the count for everyone.
    expect(await dailyBudget('each', 1, undefined, NOON)).toEqual({ ok: true });
  });

  it('keeps budgets with different names apart', async () => {
    expect(await dailyBudget('a', 1, undefined, NOON)).toEqual({ ok: true });
    expect(await dailyBudget('b', 1, undefined, NOON)).toEqual({ ok: true });
  });
});

describe('onTestNetwork', () => {
  const before = process.env.NEXT_PUBLIC_CHAIN_ID;
  const restore = () => {
    if (before === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ID;
    else process.env.NEXT_PUBLIC_CHAIN_ID = before;
  };

  it('is true on the test network, and when no network is named', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '10143';
    expect(onTestNetwork()).toBe(true);
    delete process.env.NEXT_PUBLIC_CHAIN_ID;
    expect(onTestNetwork()).toBe(true);
    restore();
  });

  it('is false on the main network', () => {
    process.env.NEXT_PUBLIC_CHAIN_ID = '143';
    expect(onTestNetwork()).toBe(false);
    restore();
  });
});
