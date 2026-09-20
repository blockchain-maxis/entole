import { describe, expect, it } from 'vitest';

import { checkSavingsAmount, savedShare, savedShareLabel, smallestSavingsAmount } from '../lib/savings';

const rate = { koboPerDollar: 158_000, quotedAt: '2026-09-20T09:00:00.000Z' };

describe('the smallest amount Savings will move', () => {
  it('is one US cent at the live rate, to the kobo', () => {
    expect(smallestSavingsAmount(rate)).toBe(1_580);
  });

  it('rounds up when a cent is not a whole number of kobo', () => {
    expect(smallestSavingsAmount({ ...rate, koboPerDollar: 158_050 })).toBe(1_581);
  });
});

describe('checking an amount before Review', () => {
  const base = { mode: 'deposit' as const, spendable: 5_000_000, saved: 2_000_000, rate };

  it('accepts an amount inside what can be spent', () => {
    expect(checkSavingsAmount({ ...base, amount: 1_000_000 })).toEqual({ ok: true });
  });

  it('says nothing about an empty entry', () => {
    expect(checkSavingsAmount({ ...base, amount: 0 })).toMatchObject({ ok: false, kind: 'empty' });
  });

  it('explains that there is nothing to move when the source is empty', () => {
    expect(checkSavingsAmount({ ...base, amount: 500, spendable: 0 })).toMatchObject({
      ok: false,
      kind: 'nothing-to-move',
    });
    expect(checkSavingsAmount({ ...base, mode: 'withdraw', amount: 500, saved: 0 })).toMatchObject({
      ok: false,
      kind: 'nothing-to-move',
    });
  });

  it('refuses anything above zero but below one cent, in plain words', () => {
    const result = checkSavingsAmount({ ...base, amount: 1_579 });
    expect(result).toMatchObject({ ok: false, kind: 'below-minimum' });
    expect(result.ok ? '' : result.reason).toBe('The smallest amount is ₦15.80, which is $0.01.');
    expect(checkSavingsAmount({ ...base, amount: 1_580 })).toEqual({ ok: true });
  });

  it('refuses more than can be spent when adding, and more than is saved when taking out', () => {
    const deposit = checkSavingsAmount({ ...base, amount: 5_000_001 });
    expect(deposit).toMatchObject({ ok: false, kind: 'above-limit' });
    expect(deposit.ok ? '' : deposit.reason).toBe('That is more than the ₦50,000 you can spend.');

    const withdraw = checkSavingsAmount({ ...base, mode: 'withdraw', amount: 2_000_001 });
    expect(withdraw).toMatchObject({ ok: false, kind: 'above-limit' });
    expect(withdraw.ok ? '' : withdraw.reason).toBe('That is more than the ₦20,000 you have in savings.');
  });

  it('allows taking out everything that is saved', () => {
    expect(checkSavingsAmount({ ...base, mode: 'withdraw', amount: 2_000_000 })).toEqual({ ok: true });
  });
});

describe('the share of money that is set aside', () => {
  it('is null unless both sides are real, so no bar is drawn for nothing', () => {
    expect(savedShare(0, 100)).toBeNull();
    expect(savedShare(100, 0)).toBeNull();
  });

  it('is saved over everything held', () => {
    expect(savedShare(750, 250)).toBe(0.25);
  });

  it('is worded as a share of the person\'s money, never as a return', () => {
    expect(savedShareLabel(0.25)).toBe('25% of your money is set aside');
    expect(savedShareLabel(0.001)).toBe('Less than 1% of your money is set aside');
    expect(savedShareLabel(0.999)).toBe('More than 99% of your money is set aside');
  });
});
