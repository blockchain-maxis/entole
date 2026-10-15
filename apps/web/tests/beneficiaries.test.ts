import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Saved people can be added, renamed and removed in the browser, as on the
 * phone, without ever showing where their money goes.
 */

const PAGES = join(__dirname, '..', 'app');
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const read = (path: string) => strip(readFileSync(join(PAGES, path), 'utf8'));

const list = read('beneficiaries/page.tsx');
const add = read('beneficiaries/new/page.tsx');
const edit = read('beneficiaries/[id]/page.tsx');
const me = read('me/page.tsx');

describe('beneficiaries in the browser', () => {
  it('can be reached from Me, and every page carries the header with the pause control', () => {
    expect(me).toMatch(/router\.push\('\/beneficiaries'\)/);
    for (const page of [list, add, edit]) expect(page).toMatch(/<Header /);
  });

  it('never put an address on the page', () => {
    for (const page of [list, add, edit]) {
      // An address is only ever compared, never written into the markup.
      expect(page).not.toMatch(/\{[^}]*\.address[^}]*\}\s*</);
      expect(page).not.toMatch(/shortAddress|truncateAddress|formatAddress|slice\(0,\s*6\)/);
    }
  });

  it('adding someone looks them up by username or number, and refuses yourself and a duplicate', () => {
    expect(add).toMatch(/findRecipient\(directory, sought\)/);
    expect(add).toMatch(/That's you\. Save someone else\./);
    expect(add).toMatch(/You already have \$\{duplicate\.nickname \?\? duplicate\.name\} saved\./);
    expect(add).toMatch(/beneficiarySchema\.safeParse\(/);
  });

  it('removing sits behind a sheet, and is refused while an allowance or seat pays them', () => {
    expect(edit).toMatch(/role="dialog"/);
    expect(edit).toMatch(/store\.allowances\.some\(\(allowance\) => allowance\.recipientId === id\)/);
    expect(edit).toMatch(/if \(load\.state !== 'ready' \|\| inUse \|\| busy\) return;/);
    expect(edit).toMatch(/Remove or change that first/);
  });

  it('keeps the same rules for a draft as the phone, from one place', () => {
    expect(edit).toMatch(/from '@entole\/core\/beneficiary-draft'/);
  });
});
