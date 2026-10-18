import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ASSISTANT_NAME } from '@entole/core/assistant-persona';

import { useAssistant } from '@/lib/assistant';
import { useAssistantPresence, type Phase } from '@/lib/assistant-presence';

import { LogoLoader } from './LogoLoader';
import { Text } from './Text';

/**
 * The assistant, as little as it can be and still be seen.
 *
 * There is no screen for it. While it listens, works out what was said, or
 * speaks, a capsule hangs from the top of the screen, in the assistant's blue,
 * with the words it hears or says. When it is done it goes. While the app is
 * only waiting to be called by name, the only sign is a small dot, so the
 * person can always tell the microphone is open. Tapping the capsule stops it.
 *
 * It sits where the toast does and never over the bottom, where the primary
 * actions are.
 */
export function AssistantPresence() {
  const { talking } = useAssistant();
  const { phase, caption, trouble, dismiss } = useAssistantPresence();
  const insets = useSafeAreaInsets();

  if (!talking) return null;

  const busy = phase === 'listening' || phase === 'thinking' || phase === 'speaking' || phase === 'confirming';
  const note = busy ? null : trouble;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 60, alignItems: 'center' }}
    >
      {busy ? (
        <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)} style={{ maxWidth: '100%' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${ASSISTANT_NAME}, ${describe(phase)}. Tap to stop.`}
            onPress={dismiss}
            className="flex-row items-center gap-3 rounded-pill border border-indigo-line bg-indigo-wash px-4 py-2.5 shadow-floating"
          >
            <Mark phase={phase} />
            <Text numberOfLines={2} className="flex-shrink font-strong text-note text-ink" style={{ maxWidth: 250 }}>
              {caption || describe(phase)}
            </Text>
          </Pressable>
        </Animated.View>
      ) : phase === 'waiting' ? (
        <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)}>
          <Waiting />
        </Animated.View>
      ) : note ? (
        <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)} style={{ maxWidth: '100%' }}>
          <View accessibilityRole="alert" className="rounded-control border border-line bg-card px-4 py-3 shadow-floating">
            <Text className="font-body text-note text-ink">{note}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function describe(phase: Phase): string {
  if (phase === 'listening') return 'Listening';
  if (phase === 'thinking') return 'Working on it';
  if (phase === 'speaking') return 'Speaking';
  if (phase === 'confirming') return 'Waiting for you to confirm';
  return '';
}

/** The sign that goes with each state: the mark while it works, moving bars while it listens or speaks. */
function Mark({ phase }: { phase: Phase }) {
  if (phase === 'thinking') return <LogoLoader size={20} label="Working on it" />;
  if (phase === 'confirming') return <Bars still />;
  return <Bars fast={phase === 'speaking'} />;
}

const BAR_HEIGHTS = [0.55, 1, 0.7];

function Bars({ fast = false, still = false }: { fast?: boolean; still?: boolean }) {
  return (
    <View className="h-5 flex-row items-center gap-[3px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {BAR_HEIGHTS.map((height, index) => (
        <Bar key={index} rest={height} delay={index * 120} fast={fast} still={still} />
      ))}
    </View>
  );
}

function Bar({ rest, delay, fast, still }: { rest: number; delay: number; fast: boolean; still: boolean }) {
  const reduce = useReducedMotion();
  const level = useSharedValue(rest);

  useEffect(() => {
    if (still || reduce) {
      level.value = rest;
      return;
    }
    const half = fast ? 220 : 420;
    level.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: half, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.3, { duration: half, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(level);
  }, [delay, fast, level, reduce, rest, still]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: level.value }] }));
  return <Animated.View className="h-5 w-[3px] rounded-pill bg-indigo" style={style} />;
}

/** Waiting to be called: one small breathing dot, so the open microphone is never hidden. */
function Waiting() {
  const reduce = useReducedMotion();
  const level = useSharedValue(0.5);

  useEffect(() => {
    if (reduce) {
      level.value = 0.8;
      return;
    }
    level.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(level);
  }, [level, reduce]);

  const style = useAnimatedStyle(() => ({ opacity: level.value }));
  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel={`Listening for hey ${ASSISTANT_NAME}`}
      className="h-2 w-2 rounded-pill bg-indigo"
      style={style}
    />
  );
}
