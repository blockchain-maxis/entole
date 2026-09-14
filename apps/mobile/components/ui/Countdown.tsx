import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { token } from '@entole/tokens';

import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 44;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The undo window. Delegation is never confirmed with a dialog and never
 * executed silently — a countdown with one-tap cancel is the only thing that
 * gives you both. The ring drains continuously; only the number steps.
 */
export function Countdown({
  seconds,
  onElapsed,
  running = true,
}: {
  seconds: number;
  onElapsed: () => void;
  running?: boolean;
}) {
  const progress = useSharedValue(1);
  const [remaining, setRemaining] = useState(seconds);
  const elapsedRef = useRef(onElapsed);

  useEffect(() => {
    elapsedRef.current = onElapsed;
  }, [onElapsed]);

  useEffect(() => {
    if (!running) return;

    progress.value = 1;
    progress.value = withTiming(0, {
      duration: seconds * 1000,
      easing: Easing.linear,
    });

    const startedAt = Date.now();
    const tick = setInterval(() => {
      const left = Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(tick);
        elapsedRef.current();
      }
    }, 250);

    return () => clearInterval(tick);
  }, [progress, running, seconds]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  return (
    <View className="h-11 w-11 items-center justify-center">
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={token.line}
          strokeWidth={STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={token.indigo.DEFAULT}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          fill="none"
          animatedProps={ringProps}
        />
      </Svg>
      <Text tabular className="font-heavy text-caption text-ink">
        {remaining}s
      </Text>
    </View>
  );
}
