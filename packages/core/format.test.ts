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

// Inputs are built from local-time components so the wall-clock reading is the
// same in any timezone. The assertions then hold on a UTC CI runner and on a
// UTC+1 laptop without pinning a zone.
const iso = (y: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(y, month, day, hour, minute, second).toISOString();

const NOW = new Date(2026, 8, 2, 10, 0);

describe('relativeMoment', () => {
  it('names today by the time', () => {
    expect(relativeMoment(iso(2026, 8, 2, 9, 4), NOW)).toBe('Today · 9:04 AM');
  });

  it('names yesterday', () => {
    expect(relativeMoment(iso(2026, 8, 1, 18, 20), NOW)).toBe('Yesterday');
  });

  it('names the weekday inside the last week', () => {
    expect(relativeMoment(iso(2026, 7, 31, 16, 12), NOW)).toBe('Mon 4:12 PM');
    expect(relativeMoment(iso(2026, 7, 30, 11, 30), NOW)).toBe('Sun 11:30 AM');
  });

  it('falls back to a date beyond a week', () => {
    expect(relativeMoment(iso(2026, 7, 1, 9, 2), NOW)).toBe('1 Aug · 9:02 AM');
  });
});

describe('settledAt', () => {
  it('timestamps a receipt to the second', () => {
    expect(settledAt(iso(2026, 8, 2, 9, 41, 7))).toBe('Settled 2 Sept 2026 at 9:41:07 AM');
  });
});

describe('resetLabel', () => {
  it('reads as a date, not a duration', () => {
    expect(resetLabel(iso(2026, 9, 1))).toBe('Resets 1 Oct');
  });
});

describe('payoutLabel', () => {
  it('reads as a date, not a duration', () => {
    expect(payoutLabel(iso(2026, 9, 1))).toBe('Payout 1 Oct');
  });
});

describe('daysUntil', () => {
  it('counts whole days ahead', () => {
    expect(daysUntil(iso(2026, 8, 5, 10, 0), NOW)).toBe(3);
  });

  it('never goes negative for a past date', () => {
    expect(daysUntil(iso(2026, 7, 1, 10, 0), NOW)).toBe(0);
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
