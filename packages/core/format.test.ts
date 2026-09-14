import { describe, expect, it } from 'vitest';

import { arrivalEstimate, relativeMoment, resetLabel, secondsWords, settledAt } from './format';

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

describe('durations', () => {
  it('does not say "1 seconds"', () => {
    expect(secondsWords(1)).toBe('1 second');
    expect(secondsWords(8)).toBe('8 seconds');
  });

  it('keeps an estimate honestly vague', () => {
    expect(arrivalEstimate(20)).toBe('about 20 seconds');
  });
});
