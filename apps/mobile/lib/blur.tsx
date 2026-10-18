import { requireOptionalNativeModule } from 'expo';
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { View } from 'react-native';

/**
 * Frosted glass, where the build can do it.
 *
 * `expo-blur` is a native module, so a build made before it was added does not
 * have it, and loading it there is reported by Metro as a fatal error that a
 * `try` does not catch (the same thing that bit the speech packages). So the
 * native half is asked for first, with the call that answers `null` instead of
 * throwing, and the package is loaded only when it is there. Without it a glass
 * sheet is the same pane, more opaque, and nothing breaks.
 *
 * On iOS the blur needs nothing more: it blurs whatever is behind it. On
 * Android it blurs one named view, the "target", and the sheet has to sit next
 * to that view, not inside it (that is how the library documents it). That is
 * what `GlassHost` is for: it puts the screen's content in the target and the
 * sheet beside it, and tells the sheet which view to blur.
 */
type BlurPackage = typeof import('expo-blur');

function load(): BlurPackage | null {
  if (!requireOptionalNativeModule('ExpoBlur')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-blur') as BlurPackage;
  } catch {
    return null;
  }
}

const blur = load();

/** The blur itself, or `null` when this build has none. */
export const NativeBlur = blur?.BlurView ?? null;
const NativeTarget = blur?.BlurTargetView ?? View;

const TargetContext = createContext<RefObject<View | null> | null>(null);

/** The view a glass sheet should blur on Android; `null` outside a `GlassHost`. */
export function useGlassTarget(): RefObject<View | null> | null {
  return useContext(TargetContext);
}

/**
 * A screen that can show glass sheets. Its content is what shows through them;
 * `sheet` is laid over it (a `SheetLayer`, or nothing while no sheet is open).
 */
export function GlassHost({ children, sheet }: { children: ReactNode; sheet: ReactNode }) {
  const target = useRef<View>(null);
  return (
    <TargetContext.Provider value={target}>
      <View style={{ flex: 1 }}>
        <NativeTarget ref={target} style={{ flex: 1 }}>
          {children}
        </NativeTarget>
        {sheet}
      </View>
    </TargetContext.Provider>
  );
}
