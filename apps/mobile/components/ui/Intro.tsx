import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

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
 * Built the way the sheets and toasts are, because that is what is known to
 * hold on a phone: a plain view pins it over the whole screen, class names lay
 * it out, and it comes and goes with entering and exiting animations. Twice it
 * was laid out with a list of styles that ended in an animated one, and on
 * Android the mark turned up in a corner instead of the middle.
 */
export function Intro() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<'showing' | 'leaving' | 'gone'>('showing');
  const drawn = reduce ? 0 : RING_DRAW_MS;

  useEffect(() => {
    const leaveAt = drawn + NAME_MS + HOLD_MS;
    const leave = setTimeout(() => setStage('leaving'), leaveAt);
    // The cover is taken out to fade; this view goes once the fade has run.
    const remove = setTimeout(() => setStage('gone'), leaveAt + LEAVE_MS + 80);
    return () => {
      clearTimeout(leave);
      clearTimeout(remove);
    };
  }, [drawn]);

  if (stage === 'gone') return null;

  return (
    <View
      style={styles.over}
      pointerEvents={stage === 'leaving' ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {stage === 'showing' ? (
        <Animated.View className="flex-1 items-center justify-center bg-paper" exiting={FadeOut.duration(LEAVE_MS)}>
          <LogoLoader size={84} once label="Entole" />
          <Animated.View entering={FadeIn.delay(Math.max(0, drawn - 120)).duration(NAME_MS)}>
            <Text className="mt-5 font-display text-heading text-ink">Entole</Text>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Edge to edge and above everything. Android draws a higher `elevation` over
  // later siblings, so without it the floating tab bar shows through.
  over: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, elevation: 1000 },
});
