import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors tsconfig's `@/*`, so route handlers import the way the app does.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // `tsconfig.json` leaves JSX as it is, for Next to compile. A test that loads
  // a route or a component has nothing after it to do that, so it is compiled here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
