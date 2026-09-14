import { describe, expect, it } from 'vitest';

import { DEMO_RATE, formatRate, toDollars, toNaira } from './fx';
import { cents, formatDollars, naira } from './money';

describe('conversion', () => {
  it('matches the amounts shown in the design', () => {
    expect(formatDollars(toDollars(naira(1_284_500), DEMO_RATE))).toBe('$812.97');
    expect(formatDollars(toDollars(naira(120_000), DEMO_RATE))).toBe('$75.95');
    expect(formatDollars(toDollars(naira(50_000), DEMO_RATE))).toBe('$31.65');
  });

  it('stays in integer minor units', () => {
    expect(Number.isInteger(toDollars(naira(1), DEMO_RATE))).toBe(true);
  });

  it('round-trips within a kobo of rounding', () => {
    const there = toDollars(naira(120_000), DEMO_RATE);
    const back = toNaira(there, DEMO_RATE);
    expect(Math.abs(back - naira(120_000))).toBeLessThanOrEqual(100);
  });

  it('converts dollars to naira', () => {
    expect(toNaira(cents(100), DEMO_RATE)).toBe(naira(1_580));
  });
});

describe('formatRate', () => {
  it('reads as a plain sentence of two prices', () => {
    expect(formatRate(DEMO_RATE)).toBe('₦1,580 = $1.00');
  });
});
