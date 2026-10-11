import { View } from 'react-native';

import { formatNairaDigits, type Naira } from '@entole/core/money';

import { Text } from './Text';

const SIZES = {
  hero: { symbol: 'text-amount-lg', digits: 'text-balance', lift: -9 },
  large: { symbol: 'text-amount', digits: 'text-balance-md', lift: -8 },
  medium: { symbol: 'text-amount-sm', digits: 'text-balance-sm', lift: -7 },
  small: { symbol: 'text-amount-xs', digits: 'text-balance-xs', lift: -6 },
} as const;

const FIGURE = {
  full: { symbol: 'text-figure-sm', digits: 'text-figure', lift: -13 },
  long: { symbol: 'text-heading', digits: 'text-figure-md', lift: -10 },
  longest: { symbol: 'text-subhead', digits: 'text-figure-sm', lift: -10 },
} as const;

/**
 * The one number a screen is about, in the display face: a balance, or what a
 * receipt is for. It steps down as the figure grows, so nine million naira
 * fits a phone as surely as nine hundred does. Tabular like every amount.
 */
export function Figure({
  value,
  steady = false,
  caret = false,
}: {
  value: Naira;
  /** While an amount is being typed nothing may move, so it holds one size. */
  steady?: boolean;
  caret?: boolean;
}) {
  const digits = formatNairaDigits(value);
  const fit = steady
    ? FIGURE.long
    : digits.length <= 9
      ? FIGURE.full
      : digits.length <= 12
        ? FIGURE.long
        : FIGURE.longest;

  return (
    <View className="flex-row items-baseline gap-0.5">
      <Text className={`font-display ${fit.symbol} text-ink`} style={{ transform: [{ translateY: fit.lift }] }}>
        ₦
      </Text>
      <Text tabular className={`font-display ${fit.digits} text-ink`}>
        {digits}
      </Text>
      {caret ? <View className="ml-1 h-10 w-0.5 self-center rounded-sm bg-ink" /> : null}
    </View>
  );
}

/**
 * A balance. The ₦ is set smaller and raised against the digits, and the digits
 * are tabular so the layout never moves while they change.
 */
export function Amount({
  value,
  size = 'hero',
  caret = false,
}: {
  value: Naira;
  size?: keyof typeof SIZES;
  caret?: boolean;
}) {
  const { symbol, digits, lift } = SIZES[size];

  return (
    <View className="flex-row items-baseline gap-0.5">
      <Text
        className={`font-strong ${symbol} text-ink`}
        style={{ transform: [{ translateY: lift }] }}
      >
        ₦
      </Text>
      <Text tabular className={`font-strong ${digits} text-ink`}>
        {formatNairaDigits(value)}
      </Text>
      {caret ? <View className="ml-1 h-11 w-0.5 rounded-sm bg-ink" /> : null}
    </View>
  );
}
