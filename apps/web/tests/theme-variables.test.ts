import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { themeCssVariables } from '@entole/tokens';

const ROOT = join(__dirname, '..');

/**
 * The palettes used to be copied into the stylesheet by hand, so a colour
 * changed in the tokens reached the phone and not the browser until someone
 * remembered. They are generated now; this holds that in place.
 */
describe('the browser gets its colours from the tokens, not from a copy', () => {
  const config = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
  const stylesheet = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  it('writes both palettes from the tokens', () => {
    expect(config).toMatch(/require\('@entole\/tokens\/tailwind-preset'\)/);
    expect(config).toMatch(/addBase\(\{ ':root': cssVars\.light, '\.dark': cssVars\.dark \}\)/);
    expect(config).toMatch(/plugins: \[themeVariables,/);
  });

  it('declares no colour variable by hand', () => {
    expect(stylesheet).not.toMatch(/--color-[a-z0-9-]+\s*:/);
  });

  it('has a dark value for every light one', () => {
    const light = Object.keys(themeCssVariables('light')).sort();
    const dark = Object.keys(themeCssVariables('dark')).sort();
    expect(light.length).toBeGreaterThan(20);
    expect(dark).toEqual(light);
  });
});
