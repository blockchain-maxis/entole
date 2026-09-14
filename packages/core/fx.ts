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
