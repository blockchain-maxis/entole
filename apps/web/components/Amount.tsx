import { formatNairaDigits, type Naira } from '@entole/core/money';

const SIZES = {
  hero: { symbol: 'text-heading', digits: 'text-figure' },
  large: { symbol: 'text-subhead', digits: 'text-figure-md' },
  medium: { symbol: 'text-subhead', digits: 'text-figure-md' },
  small: { symbol: 'text-subhead', digits: 'text-figure-sm' },
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
  return <FigureText symbol="₦" digits={formatNairaDigits(value)} steady={steady} />;
}

/**
 * The same figure from words already set: a sign and its digits. A receipt
 * anyone can open is drawn from what the server kept, which may be in dollars
 * when no naira figure could be put on it.
 */
export function FigureText({ symbol: sign, digits, steady = false }: { symbol: string; digits: string; steady?: boolean }) {
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
      <span className={`font-display text-ink ${symbol}`}>{sign}</span>
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
      <span className={`mt-1 font-display text-ink ${symbol}`}>₦</span>
      <span className={`tabular font-display text-ink ${digits}`}>{formatNairaDigits(value)}</span>
    </span>
  );
}
