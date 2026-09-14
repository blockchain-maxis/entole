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

  // Contact avatar grounds
  avatar: { 1: '#E4DACB', 2: '#EDE6DA', 3: '#E7E2D6' },

  scrim: 'rgba(18,16,14,0.28)',
};

module.exports = { colors };
