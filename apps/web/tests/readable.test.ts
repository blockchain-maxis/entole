import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { themeTokens } from '@entole/tokens';

const ROOT = join(__dirname, '..');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast between two colours, 1 (none) to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * In the browser one variable font file sits behind every font class, so a
 * class that names only the family changes nothing. For months that meant no
 * text anywhere on the web was heavier than regular.
 */
describe('text in the browser has weight', () => {
  const config = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');

  it.each([
    ['font-plain', '400'],
    ['font-body', '500'],
    ['font-strong', '600'],
    ['font-heavy', '700'],
  ])('%s is drawn at %s', (name, weight) => {
    expect(config).toContain(`'.${name}': { fontWeight: '${weight}' }`);
  });

  it('the weights are actually handed to Tailwind', () => {
    expect(config).toMatch(/plugins: \[[^\]]*fontWeights/);
  });

  it('the naira sign comes with the first font file', () => {
    expect(readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8')).toMatch(/subsets: \['latin', 'latin-ext'\]/);
  });
});

describe('a person is never a blank disc', () => {
  const files = ['components/Avatar.tsx', 'components/ConfirmSendSheet.tsx', 'app/assistant/action/page.tsx'];

  it.each(files)('%s writes initials in slate, not in the colour of the page', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const avatar = source.split('\n').filter((line) => /bg-avatar-|TONES\[tone\]/.test(line) && /className/.test(line));
    expect(avatar.length).toBeGreaterThan(0);
    for (const line of avatar) {
      expect(line).toMatch(/text-slate/);
      expect(line).not.toMatch(/text-paper|text-card/);
    }
  });

  it.each(['light', 'dark'] as const)('slate on every avatar ground can be read (%s)', (scheme) => {
    const palette = themeTokens(scheme);
    for (const tone of [1, 2, 3] as const) {
      expect(contrast(palette.slate, palette.avatar[tone]), `tone ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
