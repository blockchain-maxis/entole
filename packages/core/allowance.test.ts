import { describe, expect, it } from 'vitest';

import { cadenceWords, meterTone, viewAllowance, viewSeat, wouldExceed } from './allowance';
import { naira } from './money';
import { allowanceSchema, seatSchema, type Allowance, type Seat } from './schemas';

function build(overrides: Partial<Allowance> = {}): Allowance {
  return allowanceSchema.parse({
    id: 'a-mom',
    name: 'Monthly transfer to Mom',
    recipientId: 'c-mom',
    limitMinor: naira(100_000),
    spentMinor: naira(50_000),
    perRunMinor: naira(50_000),
    cadence: 'monthly',
    resetsAt: '2026-10-01T00:00:00.000+01:00',
    paused: false,
    ...overrides,
  });
}

describe('meterTone', () => {
  it('travels settled to caution to halt as it drains', () => {
    expect(meterTone(0.9)).toBe('settled');
    expect(meterTone(0.5)).toBe('caution');
    expect(meterTone(0.16)).toBe('caution');
    expect(meterTone(0.12)).toBe('halt');
    expect(meterTone(0)).toBe('halt');
  });
});

describe('viewAllowance', () => {
  it('renders as a remaining balance, not a permission', () => {
    const view = viewAllowance(build());
    expect(view.remainingMinor).toBe(naira(50_000));
    expect(view.remainingFraction).toBe(0.5);
    expect(view.usedPercent).toBe(50);
    expect(view.tone).toBe('caution');
  });

  it('clamps an overspent allowance to zero left', () => {
    const view = viewAllowance(build({ spentMinor: naira(140_000) }));
    expect(view.remainingMinor).toBe(0);
    expect(view.usedPercent).toBe(100);
    expect(view.tone).toBe('halt');
  });

  it('matches the design fixtures', () => {
    const school = viewAllowance(
      build({ limitMinor: naira(150_000), spentMinor: naira(131_500) }),
    );
    expect(school.remainingMinor).toBe(naira(18_500));
    expect(school.tone).toBe('halt');

    const groceries = viewAllowance(
      build({ limitMinor: naira(80_000), spentMinor: naira(8_000) }),
    );
    expect(groceries.remainingMinor).toBe(naira(72_000));
    expect(groceries.tone).toBe('settled');
  });
});

describe('wouldExceed', () => {
  it('mirrors the cap the contract enforces', () => {
    const allowance = build();
    expect(wouldExceed(allowance, naira(50_000))).toBe(false);
    expect(wouldExceed(allowance, naira(50_001))).toBe(true);
  });
});

describe('cadenceWords', () => {
  it('reads back inside the sentence', () => {
    expect(cadenceWords('monthly')).toBe('every month');
    expect(cadenceWords('weekly')).toBe('every week');
    expect(cadenceWords('on-request')).toBe('only when I ask');
  });
});

function buildSeat(overrides: Partial<Seat> = {}): Seat {
  return seatSchema.parse({
    id: 's-chidi-officer',
    name: 'Officer — supplies',
    contactId: 'c-chidi',
    role: 'officer',
    limitMinor: naira(200_000),
    spentMinor: naira(65_000),
    perRunMinor: naira(50_000),
    cadence: 'monthly',
    resetsAt: '2026-10-01T00:00:00.000+01:00',
    paused: false,
    ...overrides,
  });
}

describe('viewSeat', () => {
  it('reads through the exact same meter as a personal allowance', () => {
    const seat = viewSeat(buildSeat());
    const asAllowance = viewAllowance(
      allowanceSchema.parse({
        id: 's-chidi-officer',
        name: 'Officer — supplies',
        recipientId: 'c-chidi',
        limitMinor: naira(200_000),
        spentMinor: naira(65_000),
        perRunMinor: naira(50_000),
        cadence: 'monthly',
        resetsAt: '2026-10-01T00:00:00.000+01:00',
        paused: false,
      }),
    );
    expect(seat.remainingMinor).toBe(asAllowance.remainingMinor);
    expect(seat.tone).toBe(asAllowance.tone);
    expect(seat.usedPercent).toBe(asAllowance.usedPercent);
  });

  it('carries the role alongside the meter', () => {
    expect(viewSeat(buildSeat({ role: 'bookkeeper', limitMinor: 0, perRunMinor: 0 })).role).toBe(
      'bookkeeper',
    );
  });
});
