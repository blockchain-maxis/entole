/**
 * The token values themselves live in `packages/tokens`, shared with the web
 * app. This file only says where to look for class names.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), require('@entole/tokens/tailwind-preset')],
  plugins: [],
};
