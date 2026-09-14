/**
 * The token values live in `packages/tokens`, shared with the phone app. Only
 * the font stacks differ: the phone loads the Plus Jakarta Sans faces by their
 * Expo names, the web loads them through `next/font` behind CSS variables.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
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
  plugins: [],
};
