import { formatNairaDigits, type Naira } from '@entole/core/money';

const SIZES = {
  hero: { symbol: 'text-amount-lg', digits: 'text-balance' },
  large: { symbol: 'text-amount', digits: 'text-balance-md' },
  medium: { symbol: 'text-amount-sm', digits: 'text-balance-sm' },
  small: { symbol: 'text-amount-xs', digits: 'text-balance-xs' },
} as const;

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
