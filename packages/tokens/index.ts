// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors, light, dark, shadow } = require('./design-tokens') as {
  colors: TokenTree;
  light: PaletteTree;
  dark: PaletteTree;
  shadow: ShadowTree;
};

type PaletteTree = {
  ink: string;
  slate: string;
  mist: string;
  paper: string;
  card: string;
  line: string;
  hairline: string;
  press: string;
  track: string;
  indigo: { DEFAULT: string; deep: string; wash: string; line: string; edge: string; track: string };
  settled: { DEFAULT: string; wash: string };
  caution: { DEFAULT: string };
  halt: { DEFAULT: string; deep: string; wash: string; tint: string };
  avatar: Record<1 | 2 | 3, string>;
  'avatar-deep': Record<1 | 2 | 3, string>;
};

type TokenTree = PaletteTree & { white: string; black: string; scrim: string };

type ShadowValue = { offsetX: number; offsetY: number; blur: number; opacity: number };
type ShadowTree = { raised: ShadowValue; floating: ShadowValue };

/** A `ShadowValue` as a React Native `style` object — iOS reads the
 * shadow* props, Android reads `elevation` (blur/2, close enough at these
 * sizes that a second constant isn't worth maintaining). */
function nativeShadow(value: ShadowValue) {
  return {
    shadowColor: colors.ink,
    shadowOpacity: value.opacity,
    shadowOffset: { width: value.offsetX, height: value.offsetY },
    shadowRadius: value.blur / 2,
    elevation: Math.round(value.blur / 2),
  };
}

/**
 * Token values for the handful of native APIs that take a colour rather than a
 * class name — SVG strokes, the code renderer, haptics-free chrome. Screens and
 * components still reference tokens by class name; this is the same source of
 * truth, not a second one.
 */
export const token = colors;

/** The dark palette, same shape as `token` minus the never-themed
 * `white`/`black`/`scrim` (those stay on `token` regardless of scheme — see
 * `design-tokens.js`'s `constants`). */
export const darkToken: PaletteTree = dark;

/** `themeTokens('dark')` for the rare native call site that needs the
 * *current* scheme's raw value (SVG strokes, shadow colors) rather than a
 * `bg-x`/`text-x` className — see each platform's `useThemeColors()` in
 * `lib/theme.tsx`, which is what components should actually call. */
export function themeTokens(scheme: 'light' | 'dark'): PaletteTree {
  return scheme === 'dark' ? dark : light;
}

/** Shadow tokens as ready-to-spread React Native style objects, for the
 * rare case (e.g. an `Animated.View`) that can't take a `shadow-*`
 * className. Prefer the Tailwind class first. */
export const nativeShadowStyle = {
  raised: nativeShadow(shadow.raised),
  floating: nativeShadow(shadow.floating),
};
