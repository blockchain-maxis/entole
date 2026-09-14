import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { MeterTone } from '@entole/core/allowance';

const FILL: Record<MeterTone, string> = {
  settled: 'bg-settled',
  caution: 'bg-caution',
  halt: 'bg-halt',
};

const HEIGHTS = {
  sm: 'h-2',
  md: 'h-2.5',
  lg: 'h-3',
} as const;

type Props = {
  /** 0–1. For an allowance this is what is left, not what is spent. */
  fraction: number;
  tone: MeterTone;
  size?: keyof typeof HEIGHTS;
  /** Assistant sheets sit on the tinted ground and need a tinted track. */
  onTint?: boolean;
  /** Hatches the portion an in-flight payment is about to consume. */
  pending?: boolean;
  label?: string;
};

/**
 * The allowance meter. The same component everywhere, so the shape becomes
 * readable at a glance without anyone explaining it.
 */
export function Meter({ fraction, tone, size = 'md', onTint = false, pending = false, label }: Props) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const width = useSharedValue(clamped);

  useEffect(() => {
    width.value = withTiming(clamped, { duration: 420 });
  }, [clamped, width]);

  const style = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      className={`${HEIGHTS[size]} overflow-hidden rounded-pill ${onTint ? 'bg-indigo-track' : 'bg-track'}`}
    >
      <Animated.View className={`h-full rounded-pill ${FILL[tone]}`} style={style}>
        {pending ? <Hatch /> : null}
      </Animated.View>
    </View>
  );
}

/** Diagonal hatching marks value that is committed but not yet settled. */
function Hatch() {
  return (
    <View className="absolute inset-0 flex-row overflow-hidden">
      {Array.from({ length: 40 }, (_, index) => (
        <View
          key={index}
          className="h-8 w-1 -translate-y-2 rotate-[25deg] bg-card/60"
          style={{ marginRight: 5 }}
        />
      ))}
    </View>
  );
}
