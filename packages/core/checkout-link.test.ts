import { describe, expect, it } from 'vitest';

import { buildCheckoutLink, buildPayLink, parseCheckout, parsePayLink } from './checkout-link';
import { encodePaymentCode } from './payment-code';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const CODE = encodePaymentCode(ADDRESS);
const BASE = 'https://entole.pro';

describe('checkout link', () => {
  it('a plain link names the payee and nothing else', () => {
    const link = buildCheckoutLink(BASE, { code: CODE, kind: 'pay' });
    expect(link).toBe(`${BASE}/pay/${CODE}`);
    expect(link).not.toMatch(/0x/i);
    expect(parseCheckout(link!)).toMatchObject({ code: CODE, address: ADDRESS, kind: 'pay' });
  });

  it('carries an amount, a name and a reference through the round trip', () => {
    const link = buildCheckoutLink(BASE, {
      code: CODE,
      kind: 'invoice',
      amountMinor: 250_000_00,
      currency: 'ngn',
      payee: 'Ada & Sons Ltd',
      reference: 'INV-0042',
      note: 'September deliveries',
      dueAt: '2026-10-01',
    })!;
    expect(parseCheckout(link)).toEqual({
      code: CODE,
      address: ADDRESS,
      kind: 'invoice',
      amountMinor: 250_000_00,
      currency: 'NGN',
      payee: 'Ada & Sons Ltd',
      reference: 'INV-0042',
      note: 'September deliveries',
      dueAt: '2026-10-01',
    });
  });

  it('reads a bare code, a path and a deep link the same way', () => {
    for (const input of [CODE, CODE.toLowerCase(), `/pay/${CODE}`, `entole://pay/${CODE}`, `  ${BASE}/pay/${CODE}#x `]) {
      expect(parseCheckout(input)?.address).toBe(ADDRESS);
    }
  });

  it('drops an amount that is not a positive whole number rather than guessing', () => {
    for (const bad of ['a=-5&c=NGN', 'a=1.5&c=NGN', 'a=abc&c=NGN', 'a=0', 'a=1e3&c=NGN', 'a=0x10&c=NGN', 'a=%2B5&c=NGN', 'a=&c=NGN']) {
      const parsed = parseCheckout(`${BASE}/pay/${CODE}?${bad}`)!;
      expect(parsed.amountMinor).toBeUndefined();
      expect(parsed.currency).toBeUndefined();
    }
  });

  it('refuses a link whose code does not check out', () => {
    expect(parseCheckout(`${BASE}/pay/PAY-0000-0000`)).toBeNull();
    expect(parseCheckout(`${BASE}/pay/${CODE.slice(0, -4)}`)).toBeNull();
    expect(parseCheckout('https://example.com')).toBeNull();
    expect(parseCheckout('')).toBeNull();
    expect(buildCheckoutLink(BASE, { code: 'nope', kind: 'pay' })).toBeNull();
  });

  it('ignores a malformed escape instead of throwing', () => {
    expect(() => parseCheckout(`${BASE}/pay/${CODE}?n=%E0%A4%A`)).not.toThrow();
  });
});

describe('pay link: a username, and what it asks for', () => {
  it('is the username and nothing longer', () => {
    expect(buildPayLink(BASE, { username: 'ada.eze' })).toBe(`${BASE}/pay/@ada.eze`);
    expect(buildPayLink(`${BASE}/`, { username: '@Ada.Eze' })).toBe(`${BASE}/pay/@ada.eze`);
  });

  it('never carries a code, an address or a name', () => {
    const link = buildPayLink(BASE, {
      username: 'ada.eze',
      kind: 'invoice',
      amountMinor: 250_000_00,
      currency: 'ngn',
      reference: 'INV-0042',
      note: 'September deliveries',
      dueAt: '2026-10-01',
    })!;
    expect(link).not.toMatch(/PAY-|0x|[?&]n=/i);
    expect(parsePayLink(link)).toEqual({
      username: 'ada.eze',
      kind: 'invoice',
      amountMinor: 250_000_00,
      currency: 'NGN',
      reference: 'INV-0042',
      note: 'September deliveries',
      dueAt: '2026-10-01',
    });
  });

  it('refuses a username that is not one', () => {
    for (const bad of ['', 'ab', 'has space', 'x'.repeat(21), 'ada/eze', CODE]) {
      expect(buildPayLink(BASE, { username: bad })).toBeNull();
    }
  });

  it.each([
    `${BASE}/pay/@ada.eze`,
    'entole.pro/pay/@Ada.Eze',
    '/pay/%40ada.eze',
    'entole://pay/@ada.eze',
    `  ${BASE}/pay/@ada.eze#x `,
  ])('reads %s', (text) => {
    expect(parsePayLink(text)).toEqual({ username: 'ada.eze', kind: 'pay' });
  });

  it('reads the amount only when it is plain digits', () => {
    expect(parsePayLink('/pay/@ada.eze?a=500000&c=NGN')).toMatchObject({ amountMinor: 500_000, currency: 'NGN' });
    for (const bad of ['1e3', '0x10', '-5', '1_0', '12.5']) {
      expect(parsePayLink(`/pay/@ada.eze?a=${bad}`)).toEqual({ username: 'ada.eze', kind: 'pay' });
    }
  });

  it('is not fooled by anything that is not a username link', () => {
    for (const text of ['', '@ada.eze', 'ada.eze', `${BASE}/pay/${CODE}`, `${BASE}/pay/@a`, `${BASE}/me/@ada.eze`]) {
      expect(parsePayLink(text)).toBeNull();
    }
    // And the old reader does not take a username link for one of its own.
    expect(parseCheckout(`${BASE}/pay/@ada.eze`)).toBeNull();
  });

  it('a checkout that has a username is handed on by it; one that has none keeps the old form', () => {
    const named = buildCheckoutLink(BASE, { code: CODE, kind: 'pay', username: 'ada.eze', payee: 'Ada Eze', amountMinor: 100 });
    expect(named).toBe(`${BASE}/pay/@ada.eze?a=100`);
    expect(buildCheckoutLink(BASE, { code: CODE, kind: 'pay' })).toBe(`${BASE}/pay/${CODE}`);
  });
});
