import { describe, expect, it } from 'vitest';

import { creReleaseRequestSchema, evaluateReleaseCondition } from './chainlink-cre';
import type { Rate } from './fx';
import type { ReleaseCondition } from './schemas';

const CONDITION: ReleaseCondition = { type: 'fx-rate-at-or-below', maxKoboPerDollar: 155_000 };

function rate(koboPerDollar: number): Rate {
  return { koboPerDollar, quotedAt: '2026-09-19T00:00:00.000Z' };
}

describe('evaluateReleaseCondition', () => {
  it('releases once the observed rate is at or below the threshold', () => {
    expect(evaluateReleaseCondition(CONDITION, rate(155_000))).toBe(true);
    expect(evaluateReleaseCondition(CONDITION, rate(150_000))).toBe(true);
  });

  it('withholds release while the observed rate is above the threshold', () => {
    expect(evaluateReleaseCondition(CONDITION, rate(158_000))).toBe(false);
  });
});

describe('creReleaseRequestSchema', () => {
  it('parses a well-formed callback payload', () => {
    const parsed = creReleaseRequestSchema.parse({
      invoiceId: 'inv-3',
      observedKoboPerDollar: 154_000,
      maxKoboPerDollar: 155_000,
    });
    expect(parsed.invoiceId).toBe('inv-3');
  });

  it('rejects a non-positive observed rate rather than guessing', () => {
    expect(() =>
      creReleaseRequestSchema.parse({ invoiceId: 'inv-3', observedKoboPerDollar: 0, maxKoboPerDollar: 155_000 }),
    ).toThrow();
  });
});
