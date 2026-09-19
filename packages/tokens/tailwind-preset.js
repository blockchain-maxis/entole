/**
 * Entole design tokens, as a Tailwind preset.
 *
 * Shared by the phone app (on top of nativewind/preset) and the web app, so a
 * colour, size or radius is named in exactly one place. Component code
 * references tokens by name only — never a hex value.
 * Source of truth: docs/DESIGN.md and the `Entole - Screens` design export.
 */
const { light, dark, constants, shadow } = require('./design-tokens');

function boxShadow({ offsetX, offsetY, blur, opacity }) {
  return `${offsetX}px ${offsetY}px ${blur}px 0 rgba(18,16,14,${opacity})`;
}

function hexToRgbTriplet(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** Walks a token tree, turning every leaf hex into a `--color-<path>` CSS
 * variable name (e.g. `indigo.deep` -> `--color-indigo-deep`, `avatar.1` ->
 * `--color-avatar-1`). Both `themeCssVars()` (the variable *declarations*,
 * for a stylesheet's `:root`/`.dark` blocks) and `themeColors()` (the
 * Tailwind `colors` extension, all `rgb(var(...) / <alpha-value>)`
 * references) walk from this so the two can never drift apart. */
function walk(tree, path, onLeaf) {
  for (const [key, value] of Object.entries(tree)) {
    const nextPath = [...path, key];
    if (typeof value === 'string') {
      onLeaf(nextPath, value);
    } else {
      walk(value, nextPath, onLeaf);
    }
  }
}

/** `['indigo', 'DEFAULT']` -> `--color-indigo`, `['indigo', 'deep']` ->
 * `--color-indigo-deep`, `['ink']` -> `--color-ink` — `DEFAULT` collapses
 * into its parent, matching Tailwind's own nested-color convention. */
function varName(path) {
  const segments = path.filter((segment) => segment !== 'DEFAULT');
  return `--color-${segments.join('-')}`;
}

/** `{ '--color-ink': '18 16 14', ... }` for one palette (light or dark) —
 * spread into a stylesheet's `:root { ... }` / `.dark { ... }` block. */
function themeCssVars(palette) {
  const vars = {};
  walk(palette, [], (path, hex) => {
    vars[varName(path)] = hexToRgbTriplet(hex);
  });
  return vars;
}

/** Rebuilds the nested `colors` shape Tailwind expects, but every leaf is a
 * `rgb(var(--color-x) / <alpha-value>)` reference instead of a literal hex —
 * opacity modifiers (`bg-ink/50`) keep working, and which palette resolves
 * depends only on which `:root`/`.dark` block is active. `DEFAULT` collapses
 * into the parent key exactly like Tailwind's own convention. */
function themeColors(palette) {
  function build(tree, path) {
    const out = {};
    for (const [key, value] of Object.entries(tree)) {
      const nextPath = [...path, key];
      if (typeof value === 'string') {
        out[key] = `rgb(var(${varName(nextPath)}) / <alpha-value>)`;
      } else {
        out[key] = build(value, nextPath);
      }
    }
    return out;
  }
  return { ...build(palette, []), ...constants };
}

const colors = themeColors(light);
const cssVars = { light: themeCssVars(light), dark: themeCssVars(dark) };

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
extend: {
  colors,

  boxShadow: {
    raised: boxShadow(shadow.raised),
    floating: boxShadow(shadow.floating),
  },

  // Named so they never collide with Tailwind's font-weight utilities.
  fontFamily: {
    sans: ['PlusJakartaSans_500Medium'],
    plain: ['PlusJakartaSans_400Regular'],
    body: ['PlusJakartaSans_500Medium'],
    strong: ['PlusJakartaSans_600SemiBold'],
    heavy: ['PlusJakartaSans_700Bold'],
  },
  fontSize: {
    // Balances and amounts
    balance: ['54px', { lineHeight: '54px', letterSpacing: '-2.4px' }],
    'balance-md': ['48px', { lineHeight: '48px', letterSpacing: '-2px' }],
    'balance-sm': ['42px', { lineHeight: '42px', letterSpacing: '-1.8px' }],
    'balance-xs': ['38px', { lineHeight: '38px', letterSpacing: '-1.5px' }],

    // Headings
    hero: ['34px', { lineHeight: '39px', letterSpacing: '-1.3px' }],
    'title-xl': ['28px', { lineHeight: '34px', letterSpacing: '-1px' }],
    'title-lg': ['27px', { lineHeight: '33px', letterSpacing: '-0.9px' }],
    sentence: ['26px', { lineHeight: '42px', letterSpacing: '-0.5px' }],
    title: ['22px', { lineHeight: '28px', letterSpacing: '-0.5px' }],
    'title-sm': ['21px', { lineHeight: '27px', letterSpacing: '-0.5px' }],
    headline: ['18px', { lineHeight: '24px', letterSpacing: '-0.3px' }],
    'body-lg': ['17px', { lineHeight: '24px', letterSpacing: '-0.3px' }],
    body: ['15.5px', { lineHeight: '21px', letterSpacing: '-0.2px' }],
    'body-sm': ['15px', { lineHeight: '23px' }],
    label: ['14px', { lineHeight: '20px' }],
    'label-sm': ['13.5px', { lineHeight: '20px' }],
    caption: ['13px', { lineHeight: '18px' }],
    'caption-sm': ['12.5px', { lineHeight: '17px' }],
    badge: ['10.5px', { lineHeight: '14px', letterSpacing: '0.5px' }],
    kill: ['11px', { lineHeight: '15px', letterSpacing: '0.6px' }],

    // Amounts inside rows and sheets
    'amount-lg': ['30px', { lineHeight: '34px', letterSpacing: '-1px' }],
    amount: ['24px', { lineHeight: '28px', letterSpacing: '-0.7px' }],
    'amount-sm': ['22px', { lineHeight: '26px', letterSpacing: '-0.6px' }],
    'amount-xs': ['20px', { lineHeight: '24px', letterSpacing: '-0.4px' }],

    // Keypad glyphs
    key: ['24px', { lineHeight: '30px' }],
  },
  borderRadius: {
    pill: '999px',
    sheet: '26px',
    panel: '24px',
    card: '20px',
    tile: '18px',
    row: '16px',
    control: '14px',
    chip: '12px',
    pip: '10px',
  },
  spacing: {
    gutter: '20px',
    'gutter-lg': '24px',
  },
},
  },
};

/**
 * The `:root`/`.dark` CSS custom-property declarations both
 * `apps/web/app/globals.css` and `apps/mobile/global.css` currently
 * hand-author — exported so a sync script can regenerate/verify them
 * against `design-tokens.js` instead of the two staying in sync by hand.
 * Not consumed anywhere yet; this is that seam.
 */
module.exports.cssVars = cssVars;
