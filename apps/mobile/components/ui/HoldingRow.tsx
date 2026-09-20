import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { formatNaira, kobo } from '@entole/core/money';
import type { StockPosition } from '@entole/core/schemas';
import { formatShares } from '@entole/core/stock-broker';

import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/** One real holding: the company, how many shares, and what they are worth now. */
export function HoldingRow({ position, onPress }: { position: StockPosition; onPress: () => void }) {
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${position.companyName}, ${formatShares(position.quantityScaled)} shares`}
      onPress={onPress}
      className="flex-row items-center justify-between rounded-control border border-line bg-card px-4 py-3.5 active:border-mist"
    >
      <View className="min-w-0 flex-1 pr-3">
        <Text numberOfLines={1} className="font-strong text-body-sm text-ink">
          {position.companyName}
        </Text>
        <Text className="mt-0.5 font-body text-label-sm text-slate">
          {position.symbol} · {formatShares(position.quantityScaled)} shares
        </Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <Text tabular className="font-strong text-body-sm text-ink">
          {formatNaira(kobo(position.currentValueMinor))}
        </Text>
        <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
      </View>
    </Pressable>
  );
}
