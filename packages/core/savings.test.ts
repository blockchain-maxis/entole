import { describe, expect, it } from 'vitest';

import { ratePercent, savingsEarning } from './savings';

const base = { balanceMinor: 50_135_027, accruedMinor: 135_637, nextPayoutAt: '2026-10-10T00:00:00.000Z' };

describe('ratePercent', () => {
  it('reads as a plain percentage to one decimal, never as nothing', () => {
    expect(ratePercent(332)).toBe('3.3%');
    expect(ratePercent(300)).toBe('3%');
    expect(ratePercent(86)).toBe('0.9%');
    expect(ratePercent(5)).toBe('0.1%');
    expect(ratePercent(1250)).toBe('12.5%');
  });
});

describe('savingsEarning', () => {
  it('is nothing unless the position carries a real rate', () => {
    expect(savingsEarning(null)).toBeNull();
    expect(savingsEarning(undefined)).toBeNull();
    expect(savingsEarning(base)).toBeNull();
    expect(savingsEarning({ ...base, ratePerYearBps: 0 })).toBeNull();
  });

  it('gives the rate and what has been earned when there is one', () => {
    expect(savingsEarning({ ...base, ratePerYearBps: 330 })).toEqual({ rate: '3.3%', earnedMinor: 135_637 });
    expect(savingsEarning({ ...base, accruedMinor: 0, ratePerYearBps: 330 })).toEqual({ rate: '3.3%', earnedMinor: 0 });
  });
});
