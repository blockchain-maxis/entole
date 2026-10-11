import { formatNairaDigits, type Naira } from '@entole/core/money';

const SIZES = {
  hero: { symbol: 'text-amount-lg', digits: 'text-balance' },
  large: { symbol: 'text-amount', digits: 'text-balance-md' },
  medium: { symbol: 'text-amount-sm', digits: 'text-balance-sm' },
  small: { symbol: 'text-amount-xs', digits: 'text-balance-xs' },
} as const;

const FIGURE = {
  full: { symbol: 'mt-1.5 text-figure-sm', digits: 'text-figure' },
  long: { symbol: 'mt-1 text-heading', digits: 'text-figure-md' },
  longest: { symbol: 'mt-1 text-subhead', digits: 'text-figure-sm' },
} as const;

/**
 * The one number a screen is about, in the display face: a balance, or what a
 * receipt is for. It steps down as the figure grows, so nine million naira
 * fits a phone as surely as nine hundred does. Tabular like every amount.
 */
export function Figure({ value, steady = false }: { value: Naira; steady?: boolean }) {
  const digits = formatNairaDigits(value);
  // While an amount is being typed nothing may move, so it holds one size.
  const { symbol, digits: size } = steady
    ? FIGURE.long
    : digits.length <= 9
      ? FIGURE.full
      : digits.length <= 12
        ? FIGURE.long
        : FIGURE.longest;

  return (
    <span className="flex items-start gap-0.5">
      <span className={`font-display text-ink ${symbol}`}>₦</span>
      <span className={`tabular font-display text-ink ${size}`}>{digits}</span>
    </span>
  );
}

/**
 * A balance. The ₦ is set smaller and raised against the digits, and the digits
 * are tabular so the layout never moves while they change.
 */
export function Amount({ value, size = 'hero' }: { value: Naira; size?: keyof typeof SIZES }) {
  const { symbol, digits } = SIZES[size];

  return (
    <span className="flex items-start gap-0.5">
      <span className={`mt-1 font-strong text-ink ${symbol}`}>₦</span>
      <span className={`tabular font-strong text-ink ${digits}`}>{formatNairaDigits(value)}</span>
    </span>
  );
}
