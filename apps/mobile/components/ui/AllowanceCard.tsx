import { Pressable, View } from 'react-native';

import type { AllowanceView } from '@entole/core/allowance';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';

import { Meter } from './Meter';
import { Text } from './Text';

/**
 * An allowance always reads as a balance with something left in it — never as a
 * permission, a scope, a key or a toggle.
 */
export function AllowanceCard({
  allowance,
  resetsAt,
  onPress,
}: {
  allowance: AllowanceView;
  resetsAt: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${allowance.name}, ${formatNaira(allowance.remainingMinor)} left of ${formatNaira(
        allowance.limitMinor,
      )}`}
      disabled={!onPress}
      onPress={onPress}
      className="rounded-row border border-line bg-card px-4 pb-[18px] pt-4 active:border-mist"
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 font-strong text-body text-ink">{allowance.name}</Text>
        <Text tabular className="pt-0.5 font-strong text-caption-sm text-mist">
          {allowance.paused ? 'Paused' : resetLabel(resetsAt)}
        </Text>
      </View>

      <View className="mt-3 flex-row items-baseline gap-1.5">
        <Text tabular className="font-strong text-amount-sm text-ink">
          {formatNaira(allowance.remainingMinor)}
        </Text>
        <Text tabular className="font-body text-label-sm text-slate">
          left of {formatNaira(allowance.limitMinor)}
        </Text>
      </View>

      <View className="mt-3.5">
        <Meter
          fraction={allowance.remainingFraction}
          tone={allowance.tone}
          label={`${allowance.name} remaining`}
        />
      </View>
    </Pressable>
  );
}
