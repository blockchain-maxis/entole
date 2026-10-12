import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/lib/theme';

import { LogoLoader, RING_DRAW_MS } from './LogoLoader';
import { Text } from './Text';

const NAME_MS = 260;
const HOLD_MS = 320;
const LEAVE_MS = 240;

/**
 * What follows the splash screen when the app is opened: the mark draws its
 * ring round to the bar, the name comes up under it, and it gives way to the
 * app. Once per launch, a little over a second, and it never waits on
 * anything: the app is loading behind it the whole time. It picks up exactly
 * where the splash image left off, on the same ground, so the two read as one.
 *
 * A plain view pins it over the whole screen, and the animated one inside only
 * fades. With both jobs on the animated view its position was dropped on
 * Android, and the mark turned up in line at the bottom of the screen.
 */
export function Intro() {
  const colors = useThemeColors();
  const reduce = useReducedMotion();
  const [gone, setGone] = useState(false);
  const name = useSharedValue(0);
  const cover = useSharedValue(1);

  useEffect(() => {
    const drawn = reduce ? 0 : RING_DRAW_MS;
    name.value = withDelay(drawn - 120, withTiming(1, { duration: NAME_MS }));
    const leaveAt = drawn + NAME_MS + HOLD_MS;
    cover.value = withDelay(leaveAt, withTiming(0, { duration: LEAVE_MS }));
    const timer = setTimeout(() => setGone(true), leaveAt + LEAVE_MS + 40);
    return () => clearTimeout(timer);
  }, [cover, name, reduce]);

  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: name.value,
    transform: [{ translateY: (1 - name.value) * 8 }],
  }));

  if (gone) return null;

  return (
    <View style={styles.over} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.cover, { backgroundColor: colors.paper }, coverStyle]}>
        <LogoLoader size={84} once label="Entole" />
        <Animated.View style={nameStyle}>
          <Text className="mt-5 font-display text-heading text-ink">Entole</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the toasts (50) and everything else, edge to edge.
  over: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100 },
  cover: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
