'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * System-default, with a manual override — the web half of the pair with
 * `apps/mobile/lib/theme.tsx`. Same `ThemePreference`/`useTheme()` shape;
 * only the persistence and DOM-application mechanism differ (`localStorage`
 * + toggling `.dark` on `<html>` here, `expo-secure-store` + NativeWind's
 * `colorScheme` there).
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_KEY = 'entole.theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function resolve(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
}

function applyToDocument(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Reads localStorage synchronously on first client render (not in an
  // effect) so the very first paint already matches the stored preference —
  // this still races the layout's blocking inline script for the *very*
  // first paint before React hydrates, which is what that script is for;
  // this just keeps React's own state in sync with what the DOM already
  // shows the instant it takes over.
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(preference));

  useEffect(() => {
    function apply() {
      const next = resolve(preference);
      setResolved(next);
      applyToDocument(next);
    }
    apply();

    if (preference !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() {
      const following = resolve('system');
      setResolved(following);
      applyToDocument(following);
    }
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    window.localStorage.setItem(THEME_KEY, next);
  }

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

/** The inline script `apps/web/app/layout.tsx` renders before hydration, as
 * a plain string (can't import this module into a `<script>` tag). Reads
 * the same `entole.theme` key and applies `.dark` before first paint, so
 * there's no light-then-dark flash for a returning dark-mode visitor. */
export const BLOCKING_THEME_SCRIPT = `(function(){try{var k='entole.theme',s=localStorage.getItem(k),d=(s==='light'||s==='dark')?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;
