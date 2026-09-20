import { vars } from 'nativewind';
import { createContext, Profiler, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { darkToken, themeCssVariables, themeTokens, token } from '@entole/tokens';

/**
 * System-default, with a manual override.
 *
 * One source of truth. `applied` is the scheme actually on screen, and it
 * feeds *both* kinds of colour at once: className colours (`bg-paper`,
 * `text-ink`) resolve from the CSS variables a root `vars()` wrapper sets from
 * it, and JS-token colours (`useThemeColors()`: SVG strokes, the tab bar) read
 * it directly. NativeWind's own `colorScheme` is deliberately not used — it
 * only follows the OS, ignores a manual override for className colours, and
 * asks Android for a night-mode configuration change (slow, and it left the two
 * kinds of colour disagreeing).
 *
 * The switch is a reveal: a circle in the new scheme's background grows from
 * where the person tapped until it covers the screen, `applied` flips
 * underneath, and the circle fades away to show the new theme.
 *
 * Nothing about *starting* the reveal waits on React. The circle is always
 * mounted and driven only by shared values, so the tap sets them and the UI
 * thread animates immediately — the heavy re-render (every className and token
 * colour changes) then happens while the circle is already moving, and a slow
 * frame there can't stall the motion. The veil lifts only after `applied` has
 * committed, so the old theme never flashes back through.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
type Scheme = 'light' | 'dark';
export type RevealOrigin = { x: number; y: number };

const THEME_KEY = 'entole.theme';
const COVER_MS = 360;
const FADE_MS = 240;
/** With the OS reduce-motion / animations-off flag set the sweep is shorter but
 * still a sweep: a flat circle of colour growing is not the parallax or spin
 * that setting exists to prevent, and skipping it left a dev phone with
 * animations off seeing no transition at all. */
const REDUCED_COVER_MS = 220;
/** Never leave the screen under the veil if the commit somehow never lands. */
const SAFETY_MS = 1500;

type ThemeControls = {
  preference: ThemePreference;
  /** `origin` is where the reveal grows from, in window coordinates — pass the
   * press's `pageX`/`pageY`. Omitted (or an OS-driven change), it grows from
   * the middle of the screen. */
  setPreference: (next: ThemePreference, origin?: RevealOrigin) => void;
};
type ThemeContextValue = ThemeControls & { resolved: Scheme };

// Two contexts on purpose. Choosing a preference re-renders only what reads the
// preference (the picker); the scheme every icon and surface reads changes once,
// at the flip — so a tap doesn't first re-render the whole tree, then again.
const ControlsContext = createContext<ThemeControls | null>(null);
const SchemeContext = createContext<Scheme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [applied, setApplied] = useState<Scheme>(system);

  const appliedRef = useRef<Scheme>(applied);
  const systemRef = useRef<Scheme>(system);
  const reducedRef = useRef(reducedMotion);
  /** The scheme a reveal is heading to and hasn't committed yet. */
  const pendingTo = useRef<Scheme | null>(null);
  const startedAt = useRef(0);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cover = useSharedValue(0);
  const veil = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const tint = useSharedValue(themeTokens(system).paper);

  useEffect(() => {
    appliedRef.current = applied;
    systemRef.current = system;
    reducedRef.current = reducedMotion;
  }, [applied, system, reducedMotion]);

  // Read the saved choice once, before anything renders, so a person who picked
  // dark never sees a flash of light.
  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(THEME_KEY)
      .then((stored) => {
        if (!live) return;
        const next: ThemePreference = stored === 'light' || stored === 'dark' ? stored : 'system';
        setPreferenceState(next);
        setApplied(next === 'system' ? systemRef.current : next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const lift = useCallback(() => {
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    safetyTimer.current = null;
    veil.set(withTiming(0, { duration: FADE_MS }));
  }, [veil]);

  const play = useCallback(
    (to: Scheme, origin: RevealOrigin | null) => {
      if (flipTimer.current) clearTimeout(flipTimer.current);
      if (liftTimer.current) clearTimeout(liftTimer.current);

      if (to === appliedRef.current) {
        // Back to what is already showing: cancel the pending flip and let any
        // veil still on screen fade away.
        pendingTo.current = null;
        lift();
        return;
      }

      const from = origin ?? { x: width / 2, y: height / 2 };
      const reduced = reducedRef.current;
      pendingTo.current = to;
      startedAt.current = Date.now();
      if (__DEV__) {
        console.log(`[theme] reveal -> ${to}${reduced ? ' (reduce-motion is on: shorter sweep)' : ''}`);
      }

      tint.set(themeTokens(to).paper);
      originX.set(from.x);
      originY.set(from.y);
      const coverMs = reduced ? REDUCED_COVER_MS : COVER_MS;
      cover.set(0);
      veil.set(1);
      cover.set(withTiming(1, { duration: coverMs, easing: Easing.out(Easing.cubic) }));

      flipTimer.current = setTimeout(() => {
        if (__DEV__) console.log(`[theme] flip fired ${Date.now() - startedAt.current}ms after the tap`);
        setApplied(to);
        safetyTimer.current = setTimeout(lift, SAFETY_MS);
      }, coverMs);
    },
    [width, height, cover, veil, originX, originY, tint, lift],
  );

  // The OS switching while the app is open on "system". A reveal already
  // heading to that scheme (a tap on "System") is left alone so it keeps its origin.
  useEffect(() => {
    if (!loaded || preference !== 'system') return;
    if (system === appliedRef.current || pendingTo.current === system) return;
    play(system, null);
  }, [loaded, preference, system, play]);

  // Once the new scheme has committed, lift the veil a beat later so its
  // colours are on screen before the cover thins.
  useEffect(() => {
    if (pendingTo.current !== applied) return;
    pendingTo.current = null;
    if (__DEV__) console.log(`[theme] applied after ${Date.now() - startedAt.current}ms`);
    liftTimer.current = setTimeout(lift, 50);
    return () => {
      if (liftTimer.current) clearTimeout(liftTimer.current);
    };
  }, [applied, lift]);

  useEffect(
    () => () => {
      for (const timer of [flipTimer, liftTimer, safetyTimer]) {
        if (timer.current) clearTimeout(timer.current);
      }
    },
    [],
  );

  const setPreference = useCallback(
    (next: ThemePreference, origin?: RevealOrigin) => {
      // Start the animation before anything re-renders.
      play(next === 'system' ? systemRef.current : next, origin ?? null);
      setPreferenceState(next);
      SecureStore.setItemAsync(THEME_KEY, next).catch(() => undefined);
    },
    [play],
  );

  const cssVariables = useMemo(() => vars(themeCssVariables(applied)), [applied]);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const circleStyle = useAnimatedStyle(() => ({
    backgroundColor: tint.value,
    transform: [{ translateX: originX.value }, { translateY: originY.value }, { scale: cover.value }],
  }));
  const controls = useMemo<ThemeControls>(() => ({ preference, setPreference }), [preference, setPreference]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: themeTokens(system).paper }} />;
  }

  // Big enough that a circle centred anywhere on screen covers every corner.
  const D = Math.ceil(Math.hypot(width, height) * 2);

  return (
    <ControlsContext.Provider value={controls}>
      <SchemeContext.Provider value={applied}>
      <View style={[styles.root, cssVariables]}>
        <Profiler id="theme-flip" onRender={onRender}>
          {children}
        </Profiler>
        <Animated.View pointerEvents="none" style={[styles.layer, veilStyle]}>
          <Animated.View
            style={[{ position: 'absolute', left: -D / 2, top: -D / 2, width: D, height: D, borderRadius: D / 2 }, circleStyle]}
          />
        </Animated.View>
      </View>
      </SchemeContext.Provider>
    </ControlsContext.Provider>
  );
}

/** Dev only: how long React itself spent committing the tree. Together with the
 * `[theme]` timings this separates "React is slow" from "the JS thread was busy". */
function onRender(_id: string, phase: string, actualDuration: number) {
  if (__DEV__ && actualDuration > 80) {
    console.log(`[theme] React ${phase} took ${Math.round(actualDuration)}ms`);
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Android draws a higher `elevation` above later siblings, so the floating
  // tab bar would otherwise stay visible over the reveal.
  layer: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 1000, overflow: 'hidden' },
});

/** Preference, setter and the applied scheme. Re-renders on either — screens
 * that only need the scheme should use `useResolvedScheme`. */
export function useTheme(): ThemeContextValue {
  const controls = useContext(ControlsContext);
  const resolved = useContext(SchemeContext);
  if (!controls || !resolved) throw new Error('useTheme must be used inside ThemeProvider');
  return { ...controls, resolved };
}

export function useResolvedScheme(): Scheme {
  const resolved = useContext(SchemeContext);
  if (!resolved) throw new Error('useResolvedScheme must be used inside ThemeProvider');
  return resolved;
}

/** The current scheme's raw token values, for the handful of native APIs
 * (SVG strokes, RN `style` background colors) that take a colour rather
 * than a `bg-x`/`text-x` className — prefer the className first, this is
 * only for what can't take one. */
export function useThemeColors() {
  return useResolvedScheme() === 'dark' ? darkToken : token;
}
