import { z } from 'zod';

import { cents, kobo, type Dollars, type Naira } from './money';

/**
 * A quoted rate, held as naira minor units per one dollar, so conversion stays
 * integer arithmetic end to end.
 */
export type Rate = {
  /** Kobo per $1.00. ₦1,580 = $1.00 is 158_000. */
  koboPerDollar: number;
  quotedAt: string;
};

export const DEMO_RATE: Rate = { koboPerDollar: 158_000, quotedAt: '2026-09-02T09:40:00.000Z' };

export function toDollars(amount: Naira, rate: Rate): Dollars {
  return cents(Math.round((amount * 100) / rate.koboPerDollar));
}

export function toNaira(amount: Dollars, rate: Rate): Naira {
  return kobo(Math.round((amount * rate.koboPerDollar) / 100));
}

/** "₦1,580 = $1.00" for the receipt breakdown. */
export function formatRate(rate: Rate): string {
  const whole = Math.trunc(rate.koboPerDollar / 100);
  return `₦${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} = $1.00`;
}

/**
 * A live rate — never a made-up one. `open.er-api.com` is a free, keyless
 * rates feed (attribution is a term of use: the app links "Rates by Exchange
 * Rate API"). Its response is parsed here before anything reads it.
 */
export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

const ratesResponseSchema = z.object({
  result: z.literal('success'),
  time_last_update_unix: z.number().int().positive(),
  rates: z.object({ NGN: z.number().positive() }),
});

/** Raised when there is no usable live rate and none recent enough to reuse.
 * Plain copy: it is shown as-is. */
export class RateUnavailableError extends Error {
  constructor() {
    super("We can't reach the exchange rate right now. Try again in a moment.");
    this.name = 'RateUnavailableError';
  }
}

/** One try is given this long. A feed that hangs is the same as one that is down. */
const RATE_TIMEOUT_MS = 8_000;

export async function fetchNairaRate(fetchImpl: typeof fetch = fetch): Promise<Rate> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RATE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RATES_URL, { signal: abort.signal });
    if (!response.ok) throw new RateUnavailableError();
    const parsed = ratesResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new RateUnavailableError();
    return {
      koboPerDollar: Math.round(parsed.data.rates.NGN * 100),
      quotedAt: new Date(parsed.data.time_last_update_unix * 1000).toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

const RATE_FRESH_MS = 10 * 60 * 1000;
/** A rate older than this is refused outright rather than shown as current. */
const RATE_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
/** Waits between tries when there is no rate to fall back on. */
const RETRY_AFTER_MS = [400, 1_200];

/**
 * Serves the live rate, cached for ten minutes. If the feed is down it keeps
 * serving the last good rate for up to a day (its own `quotedAt` says how old
 * it is); beyond that it throws `RateUnavailableError` — never a fixture.
 *
 * With nothing to fall back on, one dropped request would otherwise fail the
 * whole account load, and on a patchy connection that is the first thing a
 * person sees. So a cold start tries three times before giving up. Callers
 * that arrive together share one request.
 */
export function createRateProvider(
  options: { fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let cached: { rate: Rate; fetchedAt: number } | null = null;
  let inFlight: Promise<Rate> | null = null;

  async function refresh(): Promise<Rate> {
    const fallback = cached && now() - cached.fetchedAt < RATE_STALE_LIMIT_MS ? cached.rate : null;
    // A rate to fall back on means nobody should be kept waiting for retries.
    const tries = fallback ? 1 : RETRY_AFTER_MS.length + 1;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      try {
        const rate = await fetchNairaRate(options.fetch);
        cached = { rate, fetchedAt: now() };
        return rate;
      } catch {
        if (attempt < tries - 1) await sleep(RETRY_AFTER_MS[attempt]!);
      }
    }
    if (fallback) return fallback;
    throw new RateUnavailableError();
  }

  return function getRate(): Promise<Rate> {
    if (cached && now() - cached.fetchedAt < RATE_FRESH_MS) return Promise.resolve(cached.rate);
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
