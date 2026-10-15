import { describe, expect, it } from 'vitest';

import { invoiceSalt, invoiceTag, saltPaysInvoice } from './invoice-tag';

const BUSINESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const OTHER = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80' as const;

describe('a payment that names its invoice', () => {
  it('carries the invoice tag first, and something new after it every time', () => {
    const one = invoiceSalt(BUSINESS, 'INV-0007');
    const two = invoiceSalt(BUSINESS, 'INV-0007');
    expect(one).toMatch(/^0x[0-9a-f]{64}$/);
    expect(one.slice(0, 34)).toBe(invoiceTag(BUSINESS, 'INV-0007'));
    expect(one).not.toBe(two);
  });

  it('is known for that invoice of that business, and no other', () => {
    const salt = invoiceSalt(BUSINESS, 'INV-0007');
    expect(saltPaysInvoice(salt, BUSINESS, 'INV-0007')).toBe(true);
    expect(saltPaysInvoice(salt, BUSINESS, ' inv-0007 ')).toBe(true);
    expect(saltPaysInvoice(salt, BUSINESS, 'INV-0008')).toBe(false);
    expect(saltPaysInvoice(salt, OTHER, 'INV-0007')).toBe(false);
  });

  it('a salt with no tag, or none at all, pays nothing', () => {
    expect(saltPaysInvoice(`0x${'07'.repeat(32)}`, BUSINESS, 'INV-0007')).toBe(false);
    expect(saltPaysInvoice(null, BUSINESS, 'INV-0007')).toBe(false);
    expect(saltPaysInvoice('0x1234', BUSINESS, 'INV-0007')).toBe(false);
  });
});
