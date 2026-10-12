import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRIVACY, TERMS, type LegalDocument } from '@entole/core/legal';
import { ONRAMP_CHAIN_ID } from '@entole/core/onramp';

/**
 * The Terms, the Privacy notice and the first page all say "test network" and
 * "test money", because that is what this deployment is. The day the public
 * config moves to the main network those words become false, and this test
 * fails until they are rewritten. It is the reminder, kept where it cannot be
 * forgotten: `NEXT_PUBLIC_CHAIN_ID` in `.env` and the words change together.
 */
const ROOT = join(__dirname, '..');
const chainId = Number(/^NEXT_PUBLIC_CHAIN_ID=(\d+)/m.exec(readFileSync(join(ROOT, '.env'), 'utf8'))?.[1]);
const realMoney = chainId === ONRAMP_CHAIN_ID;

const words = (document: LegalDocument) =>
  [document.lead, ...document.sections.flatMap((section) => [section.heading, ...section.body])].join('\n');
const TEST_WORDS = /test (network|money|payments?|balances?)/i;

describe('the words match the network this deployment runs on', () => {
  it('reads the network from the public config', () => {
    expect(Number.isInteger(chainId)).toBe(true);
  });

  it.each([
    ['the terms', words(TERMS)],
    ['the privacy notice', words(PRIVACY)],
    ['the first page', readFileSync(join(ROOT, 'components/Landing.tsx'), 'utf8')],
  ])('%s: says test money exactly while the money is test money', (_name, text) => {
    if (realMoney) expect(text).not.toMatch(TEST_WORDS);
    else expect(text).toMatch(TEST_WORDS);
  });

  it('on the main network the terms no longer call a balance worthless or the app unlicensed by default', () => {
    if (!realMoney) return;
    expect(words(TERMS)).not.toMatch(/has no value|not a real payment/i);
  });
});
