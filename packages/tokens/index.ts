// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors, light, dark, shadow, watermark } = require('./design-tokens') as {
  colors: TokenTree;
  light: PaletteTree;
  dark: PaletteTree;
  shadow: ShadowTree;
  watermark: WatermarkValue;
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

type WatermarkValue = {
  word: string;
  /** Degrees the rows lean by. */
  angle: number;
  size: number;
  /** From the start of one word to the start of the next along a row. */
  advance: number;
  /** From one row to the next. */
  row: number;
  /** How much of `ink` the word is drawn in. */
  opacity: number;
};

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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cssVars } = require('./tailwind-preset') as {
  cssVars: { light: Record<string, string>; dark: Record<string, string> };
};

/** A scheme's palette as CSS custom properties — `{ '--color-ink': '18 16 14',
 * ... }`, space-separated RGB triplets. The mobile app applies these on a root
 * `vars()` wrapper so every `bg-x`/`text-x` class resolves from one place,
 * instead of relying on a stylesheet block that NativeWind does not apply. */
export function themeCssVariables(scheme: 'light' | 'dark'): Record<string, string> {
  return scheme === 'dark' ? cssVars.dark : cssVars.light;
}

/** The receipt's watermark: one set of numbers for the picture, the browser
 * and the phone. See `design-tokens.js`. */
export const watermarkToken: WatermarkValue = watermark;

/** The `raised` shadow's own numbers, for the receipt picture, which is drawn
 * with neither a class name nor a native style. */
export const raisedShadow: ShadowValue = shadow.raised;

/** Shadow tokens as ready-to-spread React Native style objects, for the
 * rare case (e.g. an `Animated.View`) that can't take a `shadow-*`
 * className. Prefer the Tailwind class first. */
export const nativeShadowStyle = {
  raised: nativeShadow(shadow.raised),
  floating: nativeShadow(shadow.floating),
};
