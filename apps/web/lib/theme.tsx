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

let fadeTimer: number | undefined;
let pendingOrigin: RevealOrigin | null = null;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

/** Applies the scheme. When it actually changes it does so as a *reveal*: the
 * new theme grows out of a circle from where the person clicked (the View
 * Transitions API plus a `clip-path` animation, see globals.css). Browsers
 * without it — or people who prefer reduced motion — get the `theme-fade`
 * blend instead. The first application on load changes nothing, so nothing
 * animates. */
function applyToDocument(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  const wantsDark = resolved === 'dark';
  if (root.classList.contains('dark') === wantsDark) return;

  const origin = pendingOrigin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  pendingOrigin = null;
  const flip = () => root.classList.toggle('dark', wantsDark);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transitionDocument = document as ViewTransitionDocument;

  if (!reducedMotion && typeof transitionDocument.startViewTransition === 'function') {
    const radius = Math.hypot(
      Math.max(origin.x, window.innerWidth - origin.x),
      Math.max(origin.y, window.innerHeight - origin.y),
    );
    root.style.setProperty('--reveal-x', `${origin.x}px`);
    root.style.setProperty('--reveal-y', `${origin.y}px`);
    root.style.setProperty('--reveal-r', `${radius}px`);
    transitionDocument.startViewTransition(flip);
    return;
  }

  root.classList.add('theme-fade');
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => root.classList.remove('theme-fade'), 340);
  flip();
}

export type RevealOrigin = { x: number; y: number };

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  /** `origin` is where the reveal grows from — pass the click's
   * `clientX`/`clientY`. Omitted, it grows from the middle of the page. */
  setPreference: (next: ThemePreference, origin?: RevealOrigin) => void;
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

  function setPreference(next: ThemePreference, origin?: RevealOrigin) {
    pendingOrigin = origin ?? null;
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
