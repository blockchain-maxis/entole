import { describe, expect, it } from 'vitest';

import { checkSendAmount, groupByCountry, plainMessage, rateLine, sendBounds } from '../lib/send';

const rate = { koboPerDollar: 158_050, quotedAt: '2026-09-20T09:00:00.000Z' };

describe('the amount screens check the server limits in the account currency', () => {
  it('derives the $1.00 minimum and $10,000 maximum from the rate', () => {
    expect(sendBounds(rate)).toEqual({ min: 158_050, max: 1_580_500_000 });
  });

  it('leads a zero balance to adding money, whatever was typed', () => {
    expect(checkSendAmount({ amount: 500_000, balance: 0, rate })).toMatchObject({
      ok: false,
      kind: 'no-balance',
    });
  });

  it('says nothing about an empty entry', () => {
    expect(checkSendAmount({ amount: 0, balance: 900_000, rate })).toMatchObject({ kind: 'empty' });
  });

  it('explains the minimum plainly, to the kobo', () => {
    const result = checkSendAmount({ amount: 100_000, balance: 900_000, rate });
    expect(result).toMatchObject({ ok: false, kind: 'below-minimum' });
    expect(result.ok ? '' : result.reason).toBe('The smallest payment is ₦1,580.50, which is $1.00.');
  });

  it('refuses more than the balance, and more than the maximum', () => {
    expect(checkSendAmount({ amount: 900_001, balance: 900_000, rate })).toMatchObject({ kind: 'above-balance' });
    expect(
      checkSendAmount({ amount: 1_580_500_001, balance: 2_000_000_000, rate }),
    ).toMatchObject({ kind: 'above-maximum' });
  });

  it('lets a payment inside every bound through to Review', () => {
    expect(checkSendAmount({ amount: 500_000, balance: 900_000, rate })).toEqual({ ok: true });
  });

  it('writes the rate the quote returned, not a fixed one', () => {
    expect(rateLine(rate)).toBe('₦1,580.50 = $1.00');
    expect(rateLine({ koboPerDollar: 160_000, quotedAt: rate.quotedAt })).toBe('₦1,600 = $1.00');
  });
});

describe('an error message reaches a person only when it is already in plain words', () => {
  it('shows the gateway and sponsor messages as they are', () => {
    expect(plainMessage(new Error("You don't have enough for this payment and its fee."), 'x')).toBe(
      "You don't have enough for this payment and its fee.",
    );
  });

  it('never shows a raw failure', () => {
    expect(plainMessage(new Error('HTTP request failed. URL: https://rpc.example/'), 'fallback')).toBe('fallback');
    expect(plainMessage(new Error('execution reverted at 0xabcdef012345'), 'fallback')).toBe('fallback');
    expect(plainMessage(new Error('Failed to submit to the chain'), 'fallback')).toBe('fallback');
    expect(plainMessage('a string', 'fallback')).toBe('fallback');
    expect(plainMessage(new Error(''), 'fallback')).toBe('fallback');
  });
});

describe('sending abroad starts from where the beneficiary is', () => {
  const person = (id: string, place?: string) => ({
    id,
    name: id,
    initials: id.slice(0, 1).toUpperCase(),
    tone: 1 as const,
    ...(place ? { place } : {}),
  });

  it('groups by country name, and leaves the ones without a country for last', () => {
    const groups = groupByCountry([
      person('ada', 'GB'),
      person('kofi', 'GH'),
      person('lena'),
      person('bola', 'GB'),
      person('odd', 'Lagos'),
    ]);
    expect(groups.map((group) => [group.name, group.contacts.map((c) => c.id)])).toEqual([
      ['Ghana', ['kofi']],
      ['United Kingdom', ['ada', 'bola']],
      ['Country not set', ['lena', 'odd']],
    ]);
  });

  it('is empty when there is no one', () => {
    expect(groupByCountry([])).toEqual([]);
  });
});
