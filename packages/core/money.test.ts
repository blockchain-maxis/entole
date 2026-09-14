import { describe, expect, it } from 'vitest';

import {
  formatDelta,
  formatDollars,
  formatNaira,
  formatNairaDigits,
  kobo,
  naira,
  remaining,
  usedFraction,
} from './money';

describe('minor units', () => {
  it('refuses a non-integer amount', () => {
    expect(() => kobo(1.5)).toThrow(/integer/);
  });

  it('builds kobo from whole naira', () => {
    expect(naira(50_000)).toBe(5_000_000);
  });
});

describe('formatNaira', () => {
  it('groups thousands', () => {
    expect(formatNaira(naira(1_284_500))).toBe('₦1,284,500');
  });

  it('shows decimals only when they are not zero', () => {
    expect(formatNaira(kobo(5_000_000))).toBe('₦50,000');
    expect(formatNaira(kobo(5_000_025))).toBe('₦50,000.25');
  });

  it('can be forced to two decimals', () => {
    expect(formatNaira(kobo(5_000_000), { alwaysDecimals: true })).toBe('₦50,000.00');
  });

  it('returns digits without the symbol for split rendering', () => {
    expect(formatNairaDigits(naira(1_284_500))).toBe('1,284,500');
  });

  it('handles zero', () => {
    expect(formatNaira(kobo(0))).toBe('₦0');
  });
});

describe('formatDollars', () => {
  it('always carries two decimals', () => {
    expect(formatDollars(7_595 as never)).toBe('$75.95');
    expect(formatDollars(81_297 as never)).toBe('$812.97');
  });
});

describe('formatDelta', () => {
  it('uses a true minus sign so figures stay aligned', () => {
    expect(formatDelta(naira(50_000), 'out')).toBe('−₦50,000');
    expect(formatDelta(naira(45_000), 'in')).toBe('+₦45,000');
  });
});

describe('remaining', () => {
  it('never goes below zero', () => {
    expect(remaining(naira(100_000), naira(150_000))).toBe(0);
  });

  it('subtracts what has been spent', () => {
    expect(remaining(naira(100_000), naira(50_000))).toBe(naira(50_000));
  });
});

describe('usedFraction', () => {
  it('is clamped to 0-1', () => {
    expect(usedFraction(naira(100_000), naira(50_000))).toBe(0.5);
    expect(usedFraction(naira(100_000), naira(400_000))).toBe(1);
  });

  it('treats a zero cap as fully used', () => {
    expect(usedFraction(kobo(0), kobo(0))).toBe(1);
  });
});
