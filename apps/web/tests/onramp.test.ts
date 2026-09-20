import { describe, expect, it } from 'vitest';

import type { Checkout } from '@entole/core/checkout-link';
import { encodePaymentCode } from '@entole/core/payment-code';

import { onrampConfigured, onrampUrlFor } from '@/lib/onramp';

const ADDRESS = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as const;
const CODE = encodePaymentCode(ADDRESS);

function checkout(extra: Partial<Checkout> = {}): Checkout {
  return { code: CODE, address: ADDRESS, kind: 'pay', ...extra };
}

const TEMPLATE =
  'https://partner.example/buy?to={address}&amount={amount}&currency={currency}&ref={reference}';

describe('onrampUrlFor', () => {
  it('is null when no partner is configured', () => {
    expect(onrampUrlFor(checkout(), undefined)).toBeNull();
    expect(onrampUrlFor(checkout(), '')).toBeNull();
    expect(onrampUrlFor(checkout(), '   \n')).toBeNull();
    expect(onrampConfigured(undefined)).toBe(false);
    expect(onrampConfigured('  ')).toBe(false);
    expect(onrampConfigured(TEMPLATE)).toBe(true);
  });

  it('fills every placeholder, with the amount in major units', () => {
    const url = onrampUrlFor(
      checkout({ amountMinor: 150_000, currency: 'NGN', reference: 'INV-0042' }),
      TEMPLATE,
    )!;
    const params = new URL(url).searchParams;
    expect(new URL(url).origin).toBe('https://partner.example');
    expect(params.get('to')).toBe(ADDRESS);
    expect(params.get('amount')).toBe('1500.00');
    expect(params.get('currency')).toBe('NGN');
    expect(params.get('ref')).toBe('INV-0042');
  });

  it('computes decimals with integer arithmetic, never a float', () => {
    const amountFor = (amountMinor: number, currency = 'NGN') =>
      new URL(onrampUrlFor(checkout({ amountMinor, currency }), TEMPLATE)!).searchParams.get('amount');
    expect(amountFor(1)).toBe('0.01');
    expect(amountFor(5)).toBe('0.05');
    expect(amountFor(100)).toBe('1.00');
    expect(amountFor(150_050)).toBe('1500.50');
    // 0.1 + 0.2 style traps: 4.35 * 100 is 434.99999999999994 as a float.
    expect(amountFor(435)).toBe('4.35');
    expect(amountFor(1_000_000_000_001)).toBe('10000000000.01');
    // Zero-decimal and three-decimal currencies follow their own exponent.
    expect(amountFor(1500, 'JPY')).toBe('1500');
    expect(amountFor(1500, 'KWD')).toBe('1.500');
  });

  it('leaves amount and currency empty when the link sets none, so the payer chooses', () => {
    const params = new URL(onrampUrlFor(checkout(), TEMPLATE)!).searchParams;
    expect(params.get('amount')).toBe('');
    expect(params.get('currency')).toBe('');
    expect(params.get('ref')).toBe('');
  });

  it('reads an amount with no currency as naira', () => {
    const params = new URL(onrampUrlFor(checkout({ amountMinor: 200_000 }), TEMPLATE)!).searchParams;
    expect(params.get('currency')).toBe('NGN');
    expect(params.get('amount')).toBe('2000.00');
  });

  it('url-encodes what it substitutes, so a reference cannot rewrite the URL', () => {
    const nasty = 'a&b=c/d?e#f g%2F';
    const url = onrampUrlFor(checkout({ reference: nasty }), TEMPLATE)!;
    const parsed = new URL(url);
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.get('ref')).toBe(nasty);
    expect([...parsed.searchParams.keys()].sort()).toEqual(['amount', 'currency', 'ref', 'to']);
  });

  it('never expands a placeholder that appears inside a value', () => {
    const url = onrampUrlFor(checkout({ reference: '{amount}' }), TEMPLATE)!;
    expect(new URL(url).searchParams.get('ref')).toBe('{amount}');
  });

  it('accepts a template with the placeholders in the path and repeated', () => {
    const url = onrampUrlFor(checkout({ amountMinor: 250 }), 'https://p.example/{currency}/{amount}?a={amount}')!;
    // The link has an amount but no currency, which is read as naira.
    expect(url).toBe('https://p.example/NGN/2.50?a=2.50');
  });

  it('is null for a half-configured template rather than a broken link', () => {
    expect(onrampUrlFor(checkout(), 'https://partner.example/buy?to={address}&x={nope}')).toBeNull();
    expect(onrampUrlFor(checkout(), 'http://partner.example/buy?to={address}')).toBeNull();
    expect(onrampUrlFor(checkout(), 'javascript:alert({address})')).toBeNull();
    expect(onrampUrlFor(checkout(), 'not a url {address}')).toBeNull();
    expect(onrampUrlFor(checkout(), '{address}')).toBeNull();
  });

  it('ignores whitespace around the template', () => {
    expect(onrampUrlFor(checkout(), `  ${TEMPLATE}\n`)).not.toBeNull();
  });
});
