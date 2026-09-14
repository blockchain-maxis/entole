/**
 * Money is always an integer in minor units — kobo for naira, cents for dollars.
 * Nothing in this file returns a float, and nothing outside the render boundary
 * turns one of these into a string.
 */

declare const brand: unique symbol;

export type Currency = 'NGN' | 'USD';

/** An integer count of minor units in a specific currency. */
export type Minor<C extends Currency> = number & { readonly [brand]: C };

export type Naira = Minor<'NGN'>;
export type Dollars = Minor<'USD'>;

const MINOR_PER_MAJOR = 100;

function assertInteger(value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`Money must be an integer in minor units, received ${value}`);
  }
}

/** Wrap a raw integer of kobo. */
export function kobo(value: number): Naira {
  assertInteger(value);
  return value as Naira;
}

/** Wrap a raw integer of cents. */
export function cents(value: number): Dollars {
  assertInteger(value);
  return value as Dollars;
}

/** Build from whole naira, for fixtures and rule limits. */
export function naira(whole: number): Naira {
  assertInteger(whole);
  return kobo(whole * MINOR_PER_MAJOR);
}

export function addMinor<C extends Currency>(a: Minor<C>, b: Minor<C>): Minor<C> {
  return (a + b) as Minor<C>;
}

export function subtractMinor<C extends Currency>(a: Minor<C>, b: Minor<C>): Minor<C> {
  return (a - b) as Minor<C>;
}

/** Clamped to zero — a remaining balance is never negative. */
export function remaining<C extends Currency>(limit: Minor<C>, spent: Minor<C>): Minor<C> {
  return Math.max(0, limit - spent) as Minor<C>;
}

/** 0–1, the share of `limit` that `spent` has consumed. */
export function usedFraction<C extends Currency>(limit: Minor<C>, spent: Minor<C>): number {
  if (limit <= 0) return 1;
  return Math.min(1, Math.max(0, spent / limit));
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function splitMinor(value: number): { whole: string; fraction: string } {
  const absolute = Math.abs(value);
  const whole = Math.trunc(absolute / MINOR_PER_MAJOR);
  const fraction = absolute % MINOR_PER_MAJOR;
  return {
    whole: group(String(whole)),
    fraction: String(fraction).padStart(2, '0'),
  };
}

/**
 * "₦50,000" — two decimals appear only when the amount is not a whole naira.
 * The symbol is returned separately where a screen renders it at its own size.
 */
export function formatNaira(value: Naira, options?: { alwaysDecimals?: boolean }): string {
  return `₦${formatNairaDigits(value, options)}`;
}

export function formatNairaDigits(value: Naira, options?: { alwaysDecimals?: boolean }): string {
  const { whole, fraction } = splitMinor(value);
  const showFraction = options?.alwaysDecimals === true || fraction !== '00';
  return showFraction ? `${whole}.${fraction}` : whole;
}

/** Dollars always carry two decimals. */
export function formatDollars(value: Dollars): string {
  const { whole, fraction } = splitMinor(value);
  return `$${whole}.${fraction}`;
}

/** U+2212, not a hyphen — it aligns with tabular figures. */
export const MINUS = '−';

export function formatDelta(value: Naira, direction: 'in' | 'out'): string {
  const sign = direction === 'out' ? MINUS : '+';
  return `${sign}${formatNaira(value)}`;
}
