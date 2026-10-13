import { describe, expect, it } from 'vitest';

import { LEGAL_CONTACT, PRIVACY, TERMS, type LegalDocument } from './legal';

const words = (document: LegalDocument) =>
  [document.title, document.lead, ...document.sections.flatMap((section) => [section.heading, ...section.body])].join('\n');

describe.each([
  ['the terms', TERMS],
  ['the privacy notice', PRIVACY],
])('%s', (_name, document) => {
  const text = words(document);

  it('is written in the words the app uses, and none it never uses', () => {
    const banned = [
      'wallet',
      'crypto',
      'blockchain',
      'chain',
      'gas',
      'token',
      'on-chain',
      'signature',
      'transaction hash',
      'seed phrase',
      'recovery phrase',
    ];
    for (const word of banned) {
      expect(text, word).not.toMatch(new RegExp(`\\b${word.replace('-', '[- ]')}\\b`, 'i'));
    }
  });

  it('has no gaps left to fill in', () => {
    expect(text).not.toMatch(/\[[^\]]*\]|TODO|TBD|placeholder|lorem/i);
    expect(document.updated).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    for (const section of document.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
      for (const paragraph of section.body) expect(paragraph.trim().length).toBeGreaterThan(20);
    }
  });

  it('says where questions go', () => {
    expect(text).toContain(LEGAL_CONTACT);
  });
});

describe('the terms say what Entole is today', () => {
  const text = words(TERMS);

  it('test money, no licence, no reversal, and the limit that holds', () => {
    expect(text).toMatch(/test network/);
    expect(text).toMatch(/Test money has no value/);
    expect(text).toMatch(/not a bank/);
    expect(text).toMatch(/cannot reverse/);
    expect(text).toMatch(/enforced by the payment network itself/);
  });

  it('promises no return and no stock that can be bought', () => {
    expect(text).toMatch(/earns nothing today/);
    expect(text).toMatch(/cannot buy or sell stocks/);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});

describe('the privacy notice names what the code does', () => {
  const text = words(PRIVACY);

  it('names every company that is handed something', () => {
    for (const company of ['Vercel', 'Upstash', 'Telegram', 'Alibaba Cloud']) expect(text).toContain(company);
  });

  it('says payments are public and cannot be deleted, and that nothing is sold or tracked', () => {
    expect(text).toMatch(/public payment network/);
    expect(text).toMatch(/Neither you nor we can change or delete it/);
    expect(text).toMatch(/no tracking or analytics/);
    expect(text).toMatch(/do not sell/);
  });

  it('does not claim signing out clears what it does not clear', () => {
    expect(text).toMatch(/stay in that device’s storage until you clear/);
  });
});

describe('the privacy notice says who can open a receipt', () => {
  const text = [PRIVACY.lead, ...PRIVACY.sections.flatMap((section) => section.body)].join('\n');

  it('says anyone with the link can, with no account, and names everything it shows', () => {
    expect(text).toMatch(/A receipt can be opened by anyone who has its link, with no account/);
    expect(text).toMatch(/both people’s names and usernames, the amount, when it was delivered and the note/);
  });

  it('does not let the link pass for a secret', () => {
    // The reference is the start of the payment's own entry on the public network.
    expect(text).toMatch(/A receipt’s link is not a secret/);
    expect(text).toMatch(/someone who finds that entry can open the receipt without being sent it/);
  });

  it('says a receipt is kept until it is asked to be removed', () => {
    expect(text).toMatch(/or a receipt, stays until you ask us to remove it/);
  });
});

describe('the privacy notice says a username is published', () => {
  it('names what is published, that it is one person\'s, and that changing it frees the old one', () => {
    const text = [PRIVACY.lead, ...PRIVACY.sections.flatMap((section) => section.body)].join('\n');
    expect(text).toMatch(/your username are published/);
    expect(text).toMatch(/A username belongs to one person/);
    expect(text).toMatch(/Changing your username releases the old one/);
  });
});

