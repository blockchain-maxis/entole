import { describe, expect, it } from 'vitest';

import { buildCheckoutLink } from '@entole/core/checkout-link';
import { encodePaymentCode } from '@entole/core/payment-code';

import {
  appLinkFor,
  browserSendPathFor,
  checkoutDescription,
  checkoutFromRequest,
  checkoutTitle,
  cleanText,
  codeLabel,
  dueState,
  formatCheckoutAmount,
  minorToMajorString,
  nairaAmountOf,
} from '@/lib/checkout';
import { isPublicPath } from '@/lib/public-routes';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const CODE = encodePaymentCode(ADDRESS);

describe('checkoutFromRequest', () => {
  it('rebuilds a pay checkout from the route and query', () => {
    expect(checkoutFromRequest(CODE, { a: '150000', c: 'NGN', n: 'Ada Okafor', m: 'For the plumber' })).toEqual({
      code: CODE,
      address: ADDRESS,
      kind: 'pay',
      amountMinor: 150_000,
      currency: 'NGN',
      payee: 'Ada Okafor',
      note: 'For the plumber',
    });
  });

  it('rebuilds an invoice with a reference and due date', () => {
    const parsed = checkoutFromRequest(CODE, {
      t: 'invoice',
      a: '25000000',
      c: 'ngn',
      n: 'Ada & Sons',
      r: 'INV-0042',
      d: '2026-10-01',
    });
    expect(parsed).toMatchObject({ kind: 'invoice', reference: 'INV-0042', dueAt: '2026-10-01', payee: 'Ada & Sons' });
  });

  it('is null for anything that is not a payment code — and never a partial guess', () => {
    for (const bad of ['', 'PAY-0000-0000', 'hello', `${CODE}x`, 'x'.repeat(500)]) {
      expect(checkoutFromRequest(bad, { a: '100', n: 'Ada' })).toBeNull();
    }
  });

  it('reads an amount with no currency as naira, and drops one whose currency is garbage', () => {
    expect(checkoutFromRequest(CODE, { a: '5000' })).toMatchObject({ amountMinor: 5000, currency: 'NGN' });
    expect(checkoutFromRequest(CODE, { a: '5000', c: 'dollars!' })?.amountMinor).toBeUndefined();
  });

  it('drops an amount that is not a positive whole number', () => {
    for (const bad of ['-5', '1.5', 'abc', '0', '1e3', '0x10', ' 5', '']) {
      expect(checkoutFromRequest(CODE, { a: bad, c: 'NGN' })?.amountMinor).toBeUndefined();
    }
  });

  it('takes the first value when a key repeats, and ignores the rest', () => {
    expect(checkoutFromRequest(CODE, { n: ['Ada', 'Eve'], x: 'y' })?.payee).toBe('Ada');
  });

  it('strips control and direction-override characters from names and notes', () => {
    const parsed = checkoutFromRequest(CODE, { n: 'A‮da\u0000 Okafor​', m: 'line\none\ttwo' });
    expect(parsed?.payee).toBe('A da Okafor');
    expect(parsed?.note).toBe('line one two');
    expect(cleanText('‮​  ', 10)).toBeUndefined();
  });

  it('caps a name at 60 characters and a note at 140', () => {
    const parsed = checkoutFromRequest(CODE, { n: 'n'.repeat(400), m: 'm'.repeat(400), r: 'r'.repeat(400) });
    expect(parsed?.payee).toHaveLength(60);
    expect(parsed?.note).toHaveLength(140);
    expect(parsed?.reference).toHaveLength(40);
  });

  it('drops a due date that is not a date', () => {
    for (const bad of ['tomorrow', '2026-13-40', '2026-02-30', '01/10/2026']) {
      expect(checkoutFromRequest(CODE, { t: 'invoice', d: bad })?.dueAt).toBeUndefined();
    }
    expect(checkoutFromRequest(CODE, { t: 'invoice', d: '2026-10-01' })?.dueAt).toBe('2026-10-01');
  });

  it('keeps markup as inert text — escaping is React’s job, the string is unchanged', () => {
    expect(checkoutFromRequest(CODE, { n: '<script>alert(1)</script>' })?.payee).toBe('<script>alert(1)</script>');
  });
});

describe('amounts', () => {
  it('formats naira with the symbol and separators', () => {
    expect(formatCheckoutAmount(150_000, 'NGN')).toBe('₦1,500');
    expect(formatCheckoutAmount(150_050, 'NGN')).toBe('₦1,500.50');
  });

  it('formats another currency as a plain line', () => {
    expect(formatCheckoutAmount(150_000, 'USD')).toBe('1,500.00 USD');
    expect(formatCheckoutAmount(5, 'usd')).toBe('0.05 USD');
    expect(formatCheckoutAmount(1_500_000, 'JPY')).toBe('1,500,000 JPY');
  });

  it('converts minor to major without a float', () => {
    expect(minorToMajorString(435, 'USD')).toBe('4.35');
    expect(() => minorToMajorString(1.5, 'USD')).toThrow();
    expect(() => minorToMajorString(-1, 'USD')).toThrow();
  });

  it('pre-fills the send flow only for naira', () => {
    const base = { code: CODE, address: ADDRESS, kind: 'pay' as const };
    expect(nairaAmountOf({ ...base, amountMinor: 100, currency: 'NGN' })).toBe(100);
    expect(nairaAmountOf({ ...base, amountMinor: 100 })).toBe(100);
    expect(nairaAmountOf({ ...base, amountMinor: 100, currency: 'USD' })).toBeUndefined();
    expect(nairaAmountOf(base)).toBeUndefined();
  });
});

describe('dueState', () => {
  // 12:00 in Lagos on 1 October 2026.
  const now = new Date('2026-10-01T11:00:00Z');

  it('is null with no due date or an unreadable one', () => {
    expect(dueState(undefined, now)).toBeNull();
    expect(dueState('soon', now)).toBeNull();
  });

  it('reads the future, today and the past', () => {
    expect(dueState('2026-10-15', now)).toEqual({ label: 'Due 15 October 2026', date: '15 October 2026', overdue: false });
    expect(dueState('2026-10-01', now)).toMatchObject({ label: 'Due today', overdue: false });
    expect(dueState('2026-09-30', now)).toMatchObject({ label: 'Overdue by 1 day', overdue: true });
    expect(dueState('2026-09-20', now)).toMatchObject({ label: 'Overdue by 11 days', overdue: true });
  });

  it('counts the day in Lagos, not the visitor’s', () => {
    // 23:30 UTC on 30 Sept is already 1 Oct in Lagos (UTC+1).
    expect(dueState('2026-09-30', new Date('2026-09-30T23:30:00Z'))).toMatchObject({
      label: 'Overdue by 1 day',
      overdue: true,
    });
    expect(dueState('2026-09-30', new Date('2026-09-30T22:30:00Z'))).toMatchObject({ label: 'Due today' });
  });
});

describe('links and copy', () => {
  const checkout = checkoutFromRequest(CODE, {
    t: 'invoice',
    a: '25000000',
    c: 'NGN',
    n: 'Ada & Sons',
    r: 'INV-0042',
    m: 'September deliveries',
  })!;

  it('builds the app deep link with the same query', () => {
    const link = appLinkFor(checkout);
    expect(link.startsWith(`entole://pay/${CODE}?`)).toBe(true);
    expect(link).toContain('t=invoice');
    expect(link).toContain('a=25000000');
    expect(link).not.toMatch(/0x/i);
  });

  it('continues in the browser through the send flow, with the checkout inside', () => {
    const path = browserSendPathFor(checkout);
    expect(path.startsWith('/transfer/send?to=')).toBe(true);
    const inner = decodeURIComponent(path.slice('/transfer/send?to='.length));
    expect(inner).toBe(buildCheckoutLink('https://x.test', checkout)!.slice('https://x.test'.length));
  });

  it('labels a code by its last group only', () => {
    expect(codeLabel(checkout)).toBe(CODE.split('-').slice(-1)[0]);
  });

  it('titles a pay link and an invoice', () => {
    expect(checkoutTitle(checkoutFromRequest(CODE, { n: 'Ada' })!)).toBe('Pay Ada — Entole');
    expect(checkoutTitle(checkoutFromRequest(CODE, {})!)).toBe('Pay this person — Entole');
    expect(checkoutTitle(checkout)).toBe('Invoice INV-0042 from Ada & Sons — Entole');
    expect(checkoutTitle(checkoutFromRequest(CODE, { t: 'invoice' })!)).toBe('Invoice — Entole');
  });

  it('puts the amount in the description when there is one', () => {
    expect(checkoutDescription(checkout)).toBe('₦250,000 due to Ada & Sons. Pay this invoice with Entole.');
    expect(checkoutDescription(checkoutFromRequest(CODE, { n: 'Ada', a: '150000', c: 'NGN' })!)).toBe(
      'Pay Ada ₦1,500 with Entole.',
    );
    expect(checkoutDescription(checkoutFromRequest(CODE, {})!)).toBe('Pay this person with Entole.');
  });

  it('never puts an address or a banned word in the words it produces', () => {
    const banned = /\b(wallet|crypto|blockchain|chain|gas|token|on-chain|signature|transaction hash)\b|0x[0-9a-f]{6,}/i;
    for (const text of [checkoutTitle(checkout), checkoutDescription(checkout), appLinkFor(checkout)]) {
      expect(text).not.toMatch(banned);
    }
  });
});

describe('public routes', () => {
  it('exempts checkout pages and nothing else', () => {
    expect(isPublicPath(`/pay/${CODE}`)).toBe(true);
    expect(isPublicPath(`/pay/${CODE}/`)).toBe(true);
    for (const gated of ['/', '/pay', '/pay/', '/transfer', '/transfer/send', '/receive', '/payroll', '/me', '', null, undefined]) {
      expect(isPublicPath(gated)).toBe(false);
    }
  });
});
