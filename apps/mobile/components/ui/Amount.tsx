import { View } from 'react-native';

import { formatNairaDigits, type Naira } from '@entole/core/money';

import { Text } from './Text';

const SIZES = {
  hero: { symbol: 'text-amount-lg', digits: 'text-balance', lift: -9 },
  large: { symbol: 'text-amount', digits: 'text-balance-md', lift: -8 },
  medium: { symbol: 'text-amount-sm', digits: 'text-balance-sm', lift: -7 },
  small: { symbol: 'text-amount-xs', digits: 'text-balance-xs', lift: -6 },
} as const;

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
      {caret ? <View className="ml-1 h-11 w-0.5 rounded-sm bg-indigo" /> : null}
    </View>
  );
}
