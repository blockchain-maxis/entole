/**
 * The token values live in `packages/tokens`, shared with the phone app. Only
 * the font stacks differ: the phone loads the Plus Jakarta Sans faces by their
 * Expo names, the web loads them through `next/font` behind CSS variables.
 */

const plugin = require('tailwindcss/plugin');

const { cssVars } = require('@entole/tokens/tailwind-preset');

/**
 * The light and dark palettes as CSS variables, written from the tokens
 * instead of copied into `globals.css` by hand. A colour changed in
 * `packages/tokens/design-tokens.js` reaches the browser with nothing else to
 * edit.
 */
const themeVariables = plugin(({ addBase }) => {
  addBase({ ':root': cssVars.light, '.dark': cssVars.dark });
});

/**
 * One variable font file sits behind all four families here, so naming the
 * family changes nothing on its own: the weight has to be said too. The phone
 * gets the same four weights from four separate files under the same class
 * names (`packages/tokens/tailwind-preset.js`).
 */
const fontWeights = plugin(({ addUtilities }) => {
  addUtilities({
    '.font-plain': { fontWeight: '400' },
    '.font-body': { fontWeight: '500' },
    '.font-strong': { fontWeight: '600' },
    '.font-heavy': { fontWeight: '700' },
  });
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('@entole/tokens/tailwind-preset')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        plain: ['var(--font-plain)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        strong: ['var(--font-strong)', 'system-ui', 'sans-serif'],
        heavy: ['var(--font-heavy)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [themeVariables, fontWeights],
};
