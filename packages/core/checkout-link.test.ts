import { describe, expect, it } from 'vitest';

import { buildCheckoutLink, parseCheckout } from './checkout-link';
import { encodePaymentCode } from './payment-code';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const CODE = encodePaymentCode(ADDRESS);
const BASE = 'https://entole.vercel.app';

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
