import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  SlideInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Sheet motion, from the design: spring, damping 20, stiffness 220. */
export const SHEET_SPRING = { damping: 20, stiffness: 220, mass: 1 } as const;

const DISMISS_DISTANCE = 130;
const DISMISS_VELOCITY = 900;

type Props = {
  children: React.ReactNode;
  onDismiss: () => void;
  /** A sheet that cannot be swiped away — used where a choice must be made. */
  locked?: boolean;
  /** Leaves the top of the underlying screen visible. */
  topInset?: number;
  className?: string;
};

/**
 * Bottom sheet, not a modal. Dismissible by gesture, operable one-handed, and
 * anchored so its primary action sits under the thumb.
 */
export function Sheet({ children, onDismiss, locked = false, topInset, className }: Props) {
  const insets = useSafeAreaInsets();
  // Drag only. The entrance is a layout animation, so nothing here is driven
  // from an effect.
  const drag = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(!locked)
    .onChange((event) => {
      drag.value = Math.max(0, drag.value + event.changeY);
    })
    .onEnd((event) => {
      if (drag.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onDismiss)();
      } else {
        drag.value = withSpring(0, SHEET_SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));

  return (
    <View
      className="flex-1 justify-end"
      style={topInset != null ? { paddingTop: topInset } : undefined}
    >
      <Animated.View className="absolute inset-0 bg-scrim" entering={FadeIn.duration(220)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          className="flex-1"
          disabled={locked}
          onPress={onDismiss}
        />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          className={className}
          entering={SlideInDown.springify().damping(SHEET_SPRING.damping).stiffness(
            SHEET_SPRING.stiffness,
          )}
          style={[sheetStyle]}
        >
          <View
            className="bg-card shadow-raised"
            style={{
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              paddingHorizontal: 22,
              paddingTop: 22,
              paddingBottom: Math.max(insets.bottom, 12),
            }}
          >
            <View className="mx-auto mb-5 h-1 w-10 rounded-pill bg-line" />
            {children}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** The same grabber used by sheets that are part of a screen rather than pushed. */
export function SheetGrabber() {
  return <View className="mx-auto mb-[18px] h-1 w-10 rounded-pill bg-line" />;
}
