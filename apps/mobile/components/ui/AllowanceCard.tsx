import { Pressable, View } from 'react-native';

import { cadenceWords, type AllowanceView } from '@entole/core/allowance';
import { resetLabel } from '@entole/core/format';
import { formatNaira } from '@entole/core/money';

import { Meter } from './Meter';
import { Text } from './Text';

/**
 * An allowance, as the sentence it is: how much, to whom, how often, written
 * in the assistant's blue. Under it, what is left, as a figure and as the
 * meter. It always reads as a balance with something left in it, never as a
 * permission, a scope, a key or a toggle. A row on paper, not a box; `ruled`
 * draws the hairline above it.
 */
export function AllowanceCard({
  allowance,
  recipientName,
  resetsAt,
  ruled = false,
  onPress,
}: {
  allowance: AllowanceView;
  recipientName: string;
  resetsAt: string;
  ruled?: boolean;
  onPress?: () => void;
}) {
  const left = formatNaira(allowance.remainingMinor);
  const limit = formatNaira(allowance.limitMinor);
  const sentence = `${formatNaira(allowance.perRunMinor)} to ${recipientName} ${cadenceWords(allowance.cadence)}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sentence}. ${left} left of ${limit}`}
      disabled={!onPress}
      onPress={onPress}
      className={`py-4 active:opacity-70 ${ruled ? 'border-t border-hairline' : ''}`}
    >
      <Text tabular className="font-display-plain text-prose text-indigo">
        {sentence}
      </Text>

      <View className="mt-2 flex-row items-baseline justify-between gap-3">
        <Text tabular className="font-body text-note text-slate">
          <Text tabular className="font-strong text-ui text-ink">
            {left}
          </Text>{' '}
          left of {limit}
        </Text>
        <Text tabular className="font-body text-note text-slate">
          {allowance.paused ? 'Paused' : resetLabel(resetsAt)}
        </Text>
      </View>

      <View className="mt-2.5">
        <Meter
          size="sm"
          fraction={allowance.remainingFraction}
          tone={allowance.tone}
          label={`${left} left of the allowance for ${recipientName}`}
        />
      </View>
    </Pressable>
  );
}
