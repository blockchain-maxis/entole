import { encodePaymentCode } from '@entole/core/payment-code';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { describe, expect, it } from 'vitest';

import { cleanNote, entryFromParam, sendParamsFor } from '../lib/recipient';

const CODE = encodePaymentCode('0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01');
const BASE = 'https://entole.example';

describe('sending to whatever a person pasted or scanned', () => {
  it('reads a bare code, a link and a deep link the same way', () => {
    const id = `code:${CODE}`;
    expect(sendParamsFor(CODE)).toEqual({ contactId: id });
    expect(sendParamsFor(CODE.toLowerCase().replace(/-/g, ' '))).toEqual({ contactId: id });
    expect(sendParamsFor(`${BASE}/pay/${CODE}`)).toEqual({ contactId: id });
    expect(sendParamsFor(`entole://pay/${CODE}`)).toEqual({ contactId: id });
  });

  it('refuses anything that is not a code', () => {
    expect(sendParamsFor('')).toBeNull();
    expect(sendParamsFor('https://example.com/pay/nothing')).toBeNull();
    expect(sendParamsFor(CODE.slice(0, -2))).toBeNull();
  });

  it('carries an amount in naira and a note from a link', () => {
    const link = buildCheckoutLink(BASE, {
      code: CODE,
      kind: 'pay',
      amountMinor: 1_250_050,
      currency: 'NGN',
      note: 'Rent',
    });
    expect(sendParamsFor(link ?? '')).toEqual({ contactId: `code:${CODE}`, amount: '1250050', note: 'Rent' });
  });

  it('does not guess at an amount in another currency', () => {
    const link = buildCheckoutLink(BASE, { code: CODE, kind: 'pay', amountMinor: 5_000, currency: 'USD' });
    expect(sendParamsFor(link ?? '')).toEqual({ contactId: `code:${CODE}` });
  });

  it('lets the caller’s note win over the link’s', () => {
    const link = buildCheckoutLink(BASE, { code: CODE, kind: 'pay', note: 'From the link' });
    expect(sendParamsFor(link ?? '', 'Supplier payment')?.note).toBe('Supplier payment');
    expect(sendParamsFor(link ?? '')?.note).toBe('From the link');
  });
});

describe('a note from a route param', () => {
  it('is trimmed and kept to what the review sheet takes', () => {
    expect(cleanNote('  Supplier payment ')).toBe('Supplier payment');
    expect(cleanNote('x'.repeat(200))).toHaveLength(80);
    expect(cleanNote('   ')).toBeUndefined();
    expect(cleanNote(undefined)).toBeUndefined();
    expect(cleanNote(['a'])).toBeUndefined();
  });
});

describe('the amount a link asks for pre-fills the keypad', () => {
  it('turns kobo into what the keypad would have typed', () => {
    expect(entryFromParam('500000')).toEqual({ raw: '5000' });
    expect(entryFromParam('1250050')).toEqual({ raw: '12500.50' });
    expect(entryFromParam('5')).toEqual({ raw: '0.05' });
  });

  it('starts empty when the amount is missing, malformed, zero or too large to enter', () => {
    for (const value of [undefined, '', '0', '-5', '12.5', 'abc', ['1'], '9999999999999']) {
      expect(entryFromParam(value)).toEqual({ raw: '' });
    }
  });
});
