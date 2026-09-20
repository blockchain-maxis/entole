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
  /** Only the grabber drags the sheet. For a sheet that holds a scrolling
   * list, where a drag on the list has to scroll it instead of closing. */
  handleOnly?: boolean;
};

/**
 * Bottom sheet, not a modal. Dismissible by gesture, operable one-handed, and
 * anchored so its primary action sits under the thumb.
 */
export function Sheet({ children, onDismiss, locked = false, topInset, className, handleOnly = false }: Props) {
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

      <DragZone enabled={!handleOnly} gesture={pan}>
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
              flexShrink: 1,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              paddingHorizontal: 22,
              paddingTop: 22,
              paddingBottom: Math.max(insets.bottom, 12),
            }}
          >
            <DragZone enabled={handleOnly} gesture={pan}>
              <View className={handleOnly ? '-mt-3 pb-5 pt-3' : 'pb-5'}>
                <View className="mx-auto h-1 w-10 rounded-pill bg-line" />
              </View>
            </DragZone>
            {children}
          </View>
        </Animated.View>
      </DragZone>
    </View>
  );
}

/** Attaches the drag gesture around its child, or leaves the child alone. */
function DragZone({
  enabled,
  gesture,
  children,
}: {
  enabled: boolean;
  gesture: ReturnType<typeof Gesture.Pan>;
  children: React.ReactNode;
}) {
  return enabled ? <GestureDetector gesture={gesture}>{children as React.ReactElement}</GestureDetector> : <>{children}</>;
}

/** Lays a sheet over the whole screen, status bar and home bar included, from
 * inside a screen that is not itself presented as a sheet. */
export function SheetLayer({ children }: { children: React.ReactNode }) {
  return (
    <View className="absolute inset-0" pointerEvents="box-none">
      {children}
    </View>
  );
}

/** The same grabber used by sheets that are part of a screen rather than pushed. */
export function SheetGrabber() {
  return <View className="mx-auto mb-[18px] h-1 w-10 rounded-pill bg-line" />;
}
