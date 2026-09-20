import { describe, expect, it } from 'vitest';

import {
  arrivalEstimate,
  daysUntil,
  greetingFor,
  payoutLabel,
  relativeMoment,
  resetLabel,
  secondsWords,
  settledAt,
} from './format';

// Fixtures are quoted in West Africa Time, and the test script pins TZ to match.
const NOW = new Date('2026-09-02T10:00:00.000+01:00');

describe('relativeMoment', () => {
  it('names today by the time', () => {
    expect(relativeMoment('2026-09-02T09:04:00.000+01:00', NOW)).toBe('Today · 9:04 AM');
  });

  it('names yesterday', () => {
    expect(relativeMoment('2026-09-01T18:20:00.000+01:00', NOW)).toBe('Yesterday');
  });

  it('names the weekday inside the last week', () => {
    expect(relativeMoment('2026-08-31T16:12:00.000+01:00', NOW)).toBe('Mon 4:12 PM');
    expect(relativeMoment('2026-08-30T11:30:00.000+01:00', NOW)).toBe('Sun 11:30 AM');
  });

  it('falls back to a date beyond a week', () => {
    expect(relativeMoment('2026-08-01T09:02:00.000+01:00', NOW)).toBe('1 Aug · 9:02 AM');
  });
});

describe('settledAt', () => {
  it('timestamps a receipt to the second', () => {
    expect(settledAt('2026-09-02T09:41:07.000+01:00')).toBe('Settled 2 Sept 2026 at 9:41:07 AM');
  });
});

describe('resetLabel', () => {
  it('reads as a date, not a duration', () => {
    expect(resetLabel('2026-10-01T00:00:00.000+01:00')).toBe('Resets 1 Oct');
  });
});

describe('payoutLabel', () => {
  it('reads as a date, not a duration', () => {
    expect(payoutLabel('2026-10-01T00:00:00.000+01:00')).toBe('Payout 1 Oct');
  });
});

describe('daysUntil', () => {
  it('counts whole days ahead', () => {
    expect(daysUntil('2026-09-05T10:00:00.000+01:00', NOW)).toBe(3);
  });

  it('never goes negative for a past date', () => {
    expect(daysUntil('2026-08-01T10:00:00.000+01:00', NOW)).toBe(0);
  });
});

describe('durations', () => {
  it('does not say "1 seconds"', () => {
    expect(secondsWords(1)).toBe('1 second');
    expect(secondsWords(8)).toBe('8 seconds');
  });

  it('keeps an estimate honestly vague', () => {
    expect(arrivalEstimate(20)).toBe('about 20 seconds');
  });
});

describe('greetingFor', () => {
  // The device's local clock decides — `new Date(y, m, d, h)` builds local time.
  const at = (hour: number) => new Date(2026, 8, 20, hour, 30);

  it('follows the local hour', () => {
    expect(greetingFor(at(6))).toBe('Good morning');
    expect(greetingFor(at(11))).toBe('Good morning');
    expect(greetingFor(at(12))).toBe('Good afternoon');
    expect(greetingFor(at(16))).toBe('Good afternoon');
    expect(greetingFor(at(17))).toBe('Good evening');
    expect(greetingFor(at(23))).toBe('Good evening');
  });

  it('has no emoji', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(greetingFor(at(hour))).toMatch(/^[A-Za-z ]+$/);
    }
  });
});
