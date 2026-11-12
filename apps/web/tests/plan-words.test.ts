import { describe, expect, it } from 'vitest';

import type { AffordCheck, MoneyPicture, SafeToSpend } from '@entole/core/money-picture';

import {
  affordWords,
  balanceCheckWords,
  dayWords,
  monthsWords,
  percentWords,
  periodWords,
  safeToSpendNote,
  suggestionRow,
} from '../lib/plan-words';

const BANNED = /\b(wallet|crypto|blockchain|chain|gas|token|on-chain|signature|transaction hash)\b/i;

const safe: SafeToSpend = {
  todayMinor: 450_000,
  days: 13,
  untilIncome: true,
  committedMinor: 0,
  dueBeforeIncome: [],
  savingsSetAsideMinor: 0,
  taxSetAsideMinor: 0,
};

function pictureWith(overrides: Partial<MoneyPicture>): MoneyPicture {
  return {
    from: '2026-08-01',
    to: '2026-10-31',
    days: 92,
    thin: false,
    balanceMinor: 100_000_00,
    income: {
      totalMinor: 0,
      monthlyMinor: 0,
      sources: [
        { name: 'Corner shop', totalMinor: 30_000_00, count: 3, lastDate: '2026-10-20', monthly: false },
        { name: 'Brightloop', totalMinor: 900_000_00, count: 3, lastDate: '2026-10-25', monthly: true },
      ],
      nextExpected: '2026-11-25',
      regular: true,
    },
    out: { totalMinor: 0, monthlyMinor: 0 },
    netMonthlyMinor: 0,
    byKind: [],
    recurring: [],
    subscriptions: { count: 0, monthlyMinor: 0, items: [] },
    runwayMonths: null,
    safeToSpend: safe,
    leaks: { thresholdMinor: 0, days: 30, count: 0, totalMinor: 0, shareOfIncomeBps: null, top: [] },
    tax: null,
    suggestions: [],
    ...overrides,
  };
}

describe('the words round the money picture', () => {
  it('reads a statement date as a calendar day', () => {
    expect(dayWords('2026-11-25')).toBe('25 Nov');
    expect(dayWords('2026-08-01')).toBe('1 Aug');
  });

  it('says the period read, and the bank figure only when there is one', () => {
    const picture = pictureWith({});
    expect(periodWords(picture, null)).toBe('1 Aug – 31 Oct');
    expect(
      periodWords(picture, { at: '', from: '2026-08-01', to: '2026-10-31', lines: 40, status: 'balanced', closingMinor: 1, proven: true, model: 'm' }),
    ).toBe('1 Aug – 31 Oct · bank figure from 31 Oct');
  });

  it('names who usually pays, from the regular income only', () => {
    expect(safeToSpendNote(pictureWith({}), safe)).toBe('each day for 13 days, until 25 Nov, when Brightloop usually pays');
    expect(safeToSpendNote(pictureWith({}), { ...safe, untilIncome: false, days: 1 })).toBe("for today, until the month's end");
  });

  it('shares and months, without inventing precision', () => {
    expect(percentWords(1234)).toBe('12.3%');
    expect(monthsWords(0.4)).toBe('under a month');
    expect(monthsWords(2.44)).toBe('about 2.4 months');
    expect(monthsWords(1)).toBe('about 1 month');
  });

  it('the balance check in each of its three states', () => {
    expect(balanceCheckWords({ status: 'balanced' })).toEqual({ ok: true, words: 'Balanced to the kobo' });
    expect(balanceCheckWords({ status: 'off', differenceMinor: -1_250_00 }).words).toMatch(/^Off by ₦1,250\. A line may be missing/);
    expect(balanceCheckWords({ status: 'unknown' }).ok).toBe(false);
  });

  it('answers "can I afford it" in each verdict, with no banned word', () => {
    const base: AffordCheck = {
      amountMinor: 50_000_00,
      verdict: 'comfortable',
      runwayBefore: 4,
      runwayAfter: 3.6,
      daysToEarnBack: 9,
      safeTodayAfterMinor: 4_000_00,
      shortByMinor: 0,
    };
    for (const check of [base, { ...base, verdict: 'tight' as const, runwayAfter: 1.2 }, { ...base, verdict: 'not-now' as const, shortByMinor: 12_000_00 }]) {
      const words = affordWords(check);
      expect(`${words.headline} ${words.detail}`).not.toMatch(BANNED);
      expect(words.detail.length).toBeGreaterThan(0);
    }
    expect(affordWords({ ...base, verdict: 'not-now', shortByMinor: 12_000_00 }).detail).toMatch(/₦12,000 from money already due/);
  });

  it('every suggestion is a row that goes somewhere real', () => {
    const rows = [
      suggestionRow({ kind: 'save-underspend', amountMinor: 20_000_00, underMinor: 25_000_00 }),
      suggestionRow({ kind: 'review-subscriptions', count: 3, monthlyMinor: 15_000_00 }),
      suggestionRow({ kind: 'small-leaks', totalMinor: 40_000_00, count: 31 }),
      suggestionRow({ kind: 'thin-buffer', runwayMonths: 0.8 }),
      suggestionRow({ kind: 'set-aside-tax', monthlyMinor: 9_000_00 }),
    ];
    expect(rows[0]!.href).toBe('/grow/savings?mode=deposit&amount=2000000');
    expect(rows.map((row) => row.href)).toEqual([
      '/grow/savings?mode=deposit&amount=2000000',
      '#subscriptions',
      '#leaks',
      '/grow/savings?mode=deposit',
      '#tax',
    ]);
    for (const row of rows) expect(`${row.title} ${row.detail}`).not.toMatch(BANNED);
  });
});
