import { describe, expect, it } from 'vitest';

import { decodePaymentCode, encodePaymentCode } from './payment-code';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01';

describe('payment code', () => {
  it('round-trips an account', () => {
    expect(decodePaymentCode(encodePaymentCode(ADDRESS))).toBe(ADDRESS);
  });

  it('is opaque text: grouped, prefixed, and holds no 0x address', () => {
    const code = encodePaymentCode(ADDRESS);
    expect(code).toMatch(/^PAY(-[0-9A-Z]{1,4})+$/);
    expect(code).not.toMatch(/0x/i);
    expect(code.toLowerCase()).not.toContain(ADDRESS.slice(2, 12).toLowerCase());
  });

  it('accepts lowercase, spaces and a stray extra dash', () => {
    const code = encodePaymentCode(ADDRESS);
    expect(decodePaymentCode(code.toLowerCase().replace(/-/g, ' '))).toBe(ADDRESS);
    expect(decodePaymentCode(`  ${code}--`)).toBe(ADDRESS);
  });

  it('forgives look-alike characters people mistype', () => {
    const code = encodePaymentCode(ADDRESS);
    const swapped = code.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(decodePaymentCode(swapped)).toBe(ADDRESS);
  });

  it('refuses a mistyped character rather than paying a stranger', () => {
    const code = encodePaymentCode(ADDRESS);
    const index = code.length - 3;
    const flipped = code[index] === 'A' ? 'B' : 'A';
    expect(decodePaymentCode(code.slice(0, index) + flipped + code.slice(index + 1))).toBeNull();
  });

  it('refuses truncated, extended, unprefixed and empty input', () => {
    const code = encodePaymentCode(ADDRESS);
    expect(decodePaymentCode(code.slice(0, -4))).toBeNull();
    expect(decodePaymentCode(`${code}ABCD`)).toBeNull();
    expect(decodePaymentCode(code.replace('PAY', 'XYZ'))).toBeNull();
    expect(decodePaymentCode('')).toBeNull();
    expect(decodePaymentCode(ADDRESS)).toBeNull();
  });

  it('gives different accounts different codes', () => {
    const other = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80';
    expect(encodePaymentCode(other)).not.toBe(encodePaymentCode(ADDRESS));
    expect(decodePaymentCode(encodePaymentCode(other))).toBe(other);
  });
});
