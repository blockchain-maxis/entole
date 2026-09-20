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

export async function fetchNairaRate(fetchImpl: typeof fetch = fetch): Promise<Rate> {
  const response = await fetchImpl(RATES_URL);
  if (!response.ok) throw new RateUnavailableError();
  const parsed = ratesResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new RateUnavailableError();
  return {
    koboPerDollar: Math.round(parsed.data.rates.NGN * 100),
    quotedAt: new Date(parsed.data.time_last_update_unix * 1000).toISOString(),
  };
}

const RATE_FRESH_MS = 10 * 60 * 1000;
/** A rate older than this is refused outright rather than shown as current. */
const RATE_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * Serves the live rate, cached for ten minutes. If the feed is down it keeps
 * serving the last good rate for up to a day (its own `quotedAt` says how old
 * it is); beyond that it throws `RateUnavailableError` — never a fixture.
 */
export function createRateProvider(options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let cached: { rate: Rate; fetchedAt: number } | null = null;

  return async function getRate(): Promise<Rate> {
    if (cached && now() - cached.fetchedAt < RATE_FRESH_MS) return cached.rate;
    try {
      const rate = await fetchNairaRate(options.fetch);
      cached = { rate, fetchedAt: now() };
      return rate;
    } catch {
      if (cached && now() - cached.fetchedAt < RATE_STALE_LIMIT_MS) return cached.rate;
      throw new RateUnavailableError();
    }
  };
}
