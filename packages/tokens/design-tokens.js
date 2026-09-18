/**
 * The single source of truth for Entole's design tokens.
 *
 * `tailwind.config.js` reads this file, and so does `lib/tokens.ts` for the few
 * native APIs that take a colour value rather than a class name. No hex literal
 * appears anywhere else in the codebase.
 *
 * Source: docs/DESIGN.md and the `Entole - Screens` design export.
 */
const colors = {
  // Text
  ink: '#12100E',
  slate: '#5C564E',
  mist: '#A39C92',

  // Surfaces
  paper: '#FBF9F5',
  card: '#FFFFFF',
  white: '#FFFFFF',
  black: '#000000',
  line: '#E8E2D8',
  hairline: '#EFE9DF',
  press: '#F4F0E8',
  track: '#F2EDE4',

  // Accent — one only
  indigo: {
    DEFAULT: '#2B4EE6',
    deep: '#1D3AC0',
    wash: '#EDF0FE',
    line: '#DFE4FC',
    edge: '#C9D2FA',
    track: '#DCE2FB',
  },

  // Meter and status
  settled: { DEFAULT: '#0F7A52', wash: '#E7F2ED' },
  caution: { DEFAULT: '#B8860B' },
  halt: { DEFAULT: '#C4362F', deep: '#A82C26', wash: '#FDF1F0', tint: '#FDF4F3' },

  // Contact avatar grounds, and one deeper stop per ground for a soft
  // two-stop gradient fill — same warm-neutral family, no new hue.
  avatar: { 1: '#E4DACB', 2: '#EDE6DA', 3: '#E7E2D6' },
  'avatar-deep': { 1: '#C5BCAF', 2: '#CCC6BB', 3: '#C7C3B8' },

  scrim: 'rgba(18,16,14,0.28)',
};

/**
 * Elevation. Two levels only: `raised` (balance card, sheet header — paper
 * lifted off a desk) and `floating` (the tab bar, which needs to separate
 * from scrolling content behind it). Everything else stays flat — a
 * `border-line` card, no shadow. Both are ink-tinted, low-opacity; there is
 * no neutral "grey" shadow anywhere in this system.
 */
const shadow = {
  raised: { offsetX: 0, offsetY: 4, blur: 12, opacity: 0.07 },
  floating: { offsetX: 0, offsetY: 6, blur: 16, opacity: 0.1 },
};

module.exports = { colors, shadow };
