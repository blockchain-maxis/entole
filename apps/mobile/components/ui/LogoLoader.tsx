import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Path, Svg } from 'react-native-svg';

import { useThemeColors } from '@/lib/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The length of the ring: three quarters of a circle of radius 34. */
const RING = 0.75 * 2 * Math.PI * 34;
const CURVE = Easing.bezier(0.65, 0, 0.35, 1);

/** How long one drawing of the ring takes. The intro waits on this. */
export const RING_DRAW_MS = 780;

/**
 * The Entole mark, drawing itself. The blue ring goes round from the top and
 * stops where it meets the bar, rests there, then lets go and starts again:
 * a limit it cannot pass, which is the product, in one motion.
 *
 * It is the only thing in the app that turns: for the app starting, and for a
 * button that is busy. Anything with a known shape still loads as a skeleton.
 *
 * `once` draws it a single time and leaves it complete, for the intro.
 * `color` draws all of it in one colour, for use on a button. Someone who
 * asked for less motion gets the mark, complete and still.
 */
export function LogoLoader({
  size = 44,
  once = false,
  color,
  label = 'Loading',
}: {
  size?: number;
  once?: boolean;
  color?: string;
  label?: string;
}) {
  const colors = useThemeColors();
  const reduce = useReducedMotion();
  // 0: nothing drawn. 1: drawn round to the bar. 2: let go from the start.
  const progress = useSharedValue(reduce ? 1 : 0);

  useEffect(() => {
    if (reduce) {
      progress.value = 1;
      return;
    }
    progress.value = once
      ? withTiming(1, { duration: RING_DRAW_MS, easing: CURVE })
      : withRepeat(
          withSequence(
            withTiming(0, { duration: 0 }),
            withTiming(1, { duration: 880, easing: CURVE }),
            withDelay(240, withTiming(2, { duration: 480, easing: CURVE })),
          ),
          -1,
          false,
        );
    return () => cancelAnimation(progress);
  }, [once, progress, reduce]);

  const ring = useAnimatedProps(() => ({ strokeDashoffset: RING * (1 - progress.value) }));

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <AnimatedPath
          d="M50 16 A34 34 0 1 1 16 50"
          stroke={color ?? colors.indigo.DEFAULT}
          strokeWidth={9}
          strokeDasharray={RING}
          animatedProps={ring}
        />
        <Path d="M4 50 H26" stroke={color ?? colors.ink} strokeWidth={9} />
        <Circle cx={50} cy={50} r={7} fill={color ?? colors.ink} />
      </Svg>
    </View>
  );
}
