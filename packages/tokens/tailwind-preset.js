/**
 * Entole design tokens, as a Tailwind preset.
 *
 * Shared by the phone app (on top of nativewind/preset) and the web app, so a
 * colour, size or radius is named in exactly one place. Component code
 * references tokens by name only — never a hex value.
 * Source of truth: docs/DESIGN.md and the `Entole - Screens` design export.
 */
const { colors } = require('./design-tokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
extend: {
  colors,

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
