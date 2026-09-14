// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require('./design-tokens') as { colors: TokenTree };

type TokenTree = {
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
  scrim: string;
};

/**
 * Token values for the handful of native APIs that take a colour rather than a
 * class name — SVG strokes, the code renderer, haptics-free chrome. Screens and
 * components still reference tokens by class name; this is the same source of
 * truth, not a second one.
 */
export const token = colors;
