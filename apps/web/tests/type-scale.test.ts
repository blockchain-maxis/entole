import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['apps/web/app', 'apps/web/components', 'apps/mobile/app', 'apps/mobile/components'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

const files = ROOTS.flatMap((root) => walk(join(REPO, root)));
const preset = readFileSync(join(REPO, 'packages/tokens/tailwind-preset.js'), 'utf8');

/**
 * Tailwind drops a class it does not know without a word. The earlier type
 * scale had 25 sizes and nine radii; both apps are now on seven and four. A
 * name from the old sets would silently fall back to the browser's default
 * size, so this holds that none is used and none is defined.
 */
describe('one type scale and one set of radii, in both apps', () => {
  const OLD_SIZES =
    /(?<![\w-])text-(hero|title-xl|title-lg|title-sm|title|headline|body-lg|body-sm|body|label-sm|label|caption-sm|caption|badge|kill|amount-lg|amount-sm|amount-xs|amount|balance-md|balance-sm|balance-xs|balance)(?![\w-])/;
  const OLD_RADII = /(?<![\w-])rounded-(row|tile|panel|chip|pip)(?![\w-])/;

  it('no screen or component uses a size from the earlier scale', () => {
    const using = files.filter((file) => OLD_SIZES.test(readFileSync(file, 'utf8'))).map((file) => relative(REPO, file));
    expect(using).toEqual([]);
  });

  it('no screen or component uses a radius from the earlier set', () => {
    const using = files.filter((file) => OLD_RADII.test(readFileSync(file, 'utf8'))).map((file) => relative(REPO, file));
    expect(using).toEqual([]);
  });

  it('the preset defines the seven roles and the four radii, and none of the old names', () => {
    for (const role of ['figure', 'heading', 'subhead', 'prose', 'ui', 'note', 'micro']) {
      expect(preset).toMatch(new RegExp(`\\n    ${role}: \\['`));
    }
    for (const radius of ['pill', 'sheet', 'card', 'control']) {
      expect(preset).toMatch(new RegExp(`\\n    ${radius}: '`));
    }
    expect(preset).not.toMatch(/\n    (headline|caption|'body-lg'|'amount-lg'|balance|row|tile|panel|chip|pip): /);
  });
});
