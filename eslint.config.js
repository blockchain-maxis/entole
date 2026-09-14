const expo = require('eslint-config-expo/flat');

/**
 * Shared across the workspace. Each app may add its own `eslint.config.js` for
 * rules that only make sense on that platform.
 */
module.exports = [
  ...expo,
  {
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'] },
      },
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/.expo/**',
      '**/.next/**',
      '**/dist/**',
      '**/out/**',
      '**/next-env.d.ts',
    ],
  },
];
