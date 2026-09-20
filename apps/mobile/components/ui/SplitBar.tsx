import { View } from 'react-native';

/**
 * One real proportion: how much of the whole is the highlighted part. Only for
 * two amounts that are both real and both non-zero — it is not a meter, and
 * it never stands in for a limit or a target.
 */
export function SplitBar({ share, label }: { share: number; label: string }) {
  const clamped = Math.min(1, Math.max(0, share));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      className="h-2 flex-row overflow-hidden rounded-pill bg-track"
    >
      <View className="h-full rounded-pill bg-indigo" style={{ flexGrow: clamped, flexBasis: 0, minWidth: 6 }} />
      <View style={{ flexGrow: 1 - clamped, flexBasis: 0 }} />
    </View>
  );
}
