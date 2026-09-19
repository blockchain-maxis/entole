import { colorScheme, useColorScheme } from 'nativewind';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import { darkToken, token } from '@entole/tokens';

/**
 * System-default, with a manual override. NativeWind's own `colorScheme`
 * resolves "system" internally (via `darkMode: 'class'` in
 * apps/mobile/tailwind.config.js — see its own error message: manual
 * override is impossible without that flag), but its `useColorScheme()`
 * hook only ever reports the *resolved* value, never whether the current
 * choice is an explicit override or "follow the system." This provider
 * tracks that third state itself and persists it — theme preference isn't
 * sensitive, but `expo-secure-store` is already this app's one storage
 * mechanism (see `lib/session.ts`), so reusing it beats adding a second
 * library for one six-byte string.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_KEY = 'entole.theme';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const { colorScheme: resolved } = useColorScheme();

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(THEME_KEY).then((stored) => {
      if (!live) return;
      const next: ThemePreference = stored === 'light' || stored === 'dark' ? stored : 'system';
      setPreferenceState(next);
      colorScheme.set(next);
    });
    return () => {
      live = false;
    };
  }, []);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    colorScheme.set(next);
    void SecureStore.setItemAsync(THEME_KEY, next);
  }

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved: resolved ?? 'light', setPreference }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

/** The current scheme's raw token values, for the handful of native APIs
 * (SVG strokes, RN `style` background colors) that take a colour rather
 * than a `bg-x`/`text-x` className — prefer the className first, this is
 * only for what can't take one. */
export function useThemeColors() {
  const { resolved } = useTheme();
  return resolved === 'dark' ? darkToken : token;
}
