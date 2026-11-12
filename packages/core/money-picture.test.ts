import { describe, expect, it } from 'vitest';

import { affordCheck, buildMoneyPicture, findLeaks, findRecurring, payeeKey } from './money-picture';
import type { StatementLine } from './statement';
import { estimateIncomeTax } from './tax-ng';

const naira = (value: number) => value * 100;
const line = (date: string, direction: 'in' | 'out', amount: number, merchant: string, kind: StatementLine['kind']): StatementLine => ({
  date, description: merchant.toUpperCase(), merchant, kind, direction, amountMinor: naira(amount),
});

/** Three months of a developer's money: paid on the 25th, rent, Netflix, many small rides and snacks. */
function threeMonths(): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const month of ['08', '09', '10']) {
    lines.push(line(`2026-${month}-25`, 'in', 600_000, 'Acme Ltd', 'income'));
    lines.push(line(`2026-${month}-01`, 'out', 150_000, 'Landlord', 'rent-home'));
    lines.push(line(`2026-${month}-05`, 'out', 4_400, 'Netflix', 'subscriptions'));
    lines.push(line(`2026-${month}-06`, 'out', 30_000, 'Claude', 'subscriptions'));
    lines.push(line(`2026-${month}-10`, 'out', 20_000, 'Ikeja Electric', 'power'));
    for (let day = 11; day <= 24; day += 1) {
      lines.push(line(`2026-${month}-${String(day).padStart(2, '0')}`, 'out', 2_500, 'Bolt', 'transport'));
      lines.push(line(`2026-${month}-${String(day).padStart(2, '0')}`, 'out', 1_500, 'Chicken Republic', 'food'));
    }
  }
  return lines;
}

describe('recurring payments', () => {
  it('finds monthly payments to the same payee at about the same amount', () => {
    const found = findRecurring(threeMonths());
    expect(found.map((item) => item.name).sort()).toEqual(['Claude', 'Ikeja Electric', 'Landlord', 'Netflix']);
    const netflix = found.find((item) => item.name === 'Netflix')!;
    expect(netflix).toMatchObject({ subscription: true, count: 3, lastDate: '2026-10-05', nextDate: '2026-11-05' });
  });

  it('does not call daily rides recurring', () => {
    expect(findRecurring(threeMonths()).some((item) => item.name === 'Bolt')).toBe(false);
  });

  it('groups a payee written different ways', () => {
    expect(payeeKey({ merchant: '', description: 'POS PURCHASE BOLT 12345' })).toBe(payeeKey({ merchant: '', description: 'WEB BOLT 999' }));
  });
});

describe('the picture', () => {
  const picture = buildMoneyPicture({ lines: threeMonths(), balanceMinor: naira(400_000), today: '2026-10-26' })!;

  it('reads income as monthly and knows when it is next due', () => {
    expect(picture.income.regular).toBe(true);
    expect(picture.income.nextExpected).toBe('2026-11-25');
    expect(picture.income.sources[0]).toMatchObject({ name: 'Acme Ltd', count: 3, monthly: true });
  });

  it('counts two subscriptions and what they cost a month', () => {
    expect(picture.subscriptions).toMatchObject({ count: 2, monthlyMinor: naira(34_400) });
  });

  it('works out a safe-to-spend figure that leaves rent, bills, savings and tax aside', () => {
    const safe = picture.safeToSpend!;
    expect(safe.untilIncome).toBe(true);
    expect(safe.days).toBe(30);
    expect(safe.dueBeforeIncome.map((item) => item.name).sort()).toEqual(['Claude', 'Ikeja Electric', 'Landlord', 'Netflix']);
    expect(safe.todayMinor).toBeGreaterThan(0);
    expect(safe.todayMinor * safe.days).toBeLessThanOrEqual(naira(400_000) - safe.committedMinor);
  });

  it('finds the small leaks and their share of income', () => {
    expect(picture.leaks.count).toBeGreaterThanOrEqual(28);
    expect(picture.leaks.top[0]?.name).toBe('Bolt');
    expect(picture.leaks.shareOfIncomeBps).toBeGreaterThan(0);
    expect(picture.suggestions.some((item) => item.kind === 'small-leaks')).toBe(true);
  });

  it('says nothing it cannot back: thin data gives no runway and no safe figure', () => {
    const thin = buildMoneyPicture({ lines: threeMonths().filter((l) => l.date >= '2026-10-20'), balanceMinor: naira(400_000), today: '2026-10-26' })!;
    expect(thin.thin).toBe(true);
    expect(thin.safeToSpend).toBeNull();
    expect(thin.runwayMonths).toBeNull();
    expect(affordCheck(thin, naira(1_000))).toBeNull();
  });

  it('has no balance-based figures without a balance', () => {
    const blind = buildMoneyPicture({ lines: threeMonths(), balanceMinor: null, today: '2026-10-26' })!;
    expect(blind.safeToSpend).toBeNull();
    expect(blind.runwayMonths).toBeNull();
  });

  it('suggests saving half of an underspent month', () => {
    const lines = threeMonths().filter((l) => !(l.date >= '2026-10-11' && l.merchant === 'Bolt'));
    const lean = buildMoneyPicture({ lines, balanceMinor: naira(400_000), today: '2026-10-26' })!;
    const save = lean.suggestions.find((item) => item.kind === 'save-underspend');
    expect(save && save.kind === 'save-underspend' && save.amountMinor > 0).toBe(true);
  });
});

describe('can I afford it', () => {
  const picture = buildMoneyPicture({ lines: threeMonths(), balanceMinor: naira(400_000), today: '2026-10-26' })!;

  it('is comfortable, tight or not now from the person\'s own figures', () => {
    expect(affordCheck(picture, naira(5_000))?.verdict).toBe('tight');
    expect(affordCheck(picture, naira(390_000))).toMatchObject({ verdict: 'not-now' });
    const rich = buildMoneyPicture({ lines: threeMonths(), balanceMinor: naira(3_000_000), today: '2026-10-26' })!;
    const check = affordCheck(rich, naira(200_000))!;
    expect(check.verdict).toBe('comfortable');
    expect(check.runwayAfter!).toBeLessThan(check.runwayBefore!);
    expect(check.daysToEarnBack).toBeGreaterThan(0);
  });
});

describe('next month', () => {
  it('keeps the day, or the month\'s last day', async () => {
    const { nextMonthDay } = await import('./money-picture');
    expect(nextMonthDay('2026-01-31')).toBe('2026-02-28');
    expect(nextMonthDay('2026-12-05')).toBe('2027-01-05');
  });
});

describe('leaks threshold', () => {
  it('ties small to income and stays within ₦1,500 to ₦10,000', () => {
    expect(findLeaks([], '2026-10-31', naira(50_000)).thresholdMinor).toBe(naira(1_500));
    expect(findLeaks([], '2026-10-31', naira(10_000_000)).thresholdMinor).toBe(naira(10_000));
    expect(findLeaks([], '2026-10-31', 0).thresholdMinor).toBe(naira(5_000));
  });
});

describe('income tax estimate', () => {
  it('charges nothing on the first ₦800,000', () => {
    expect(estimateIncomeTax({ yearlyIncomeMinor: naira(800_000) }).yearlyTaxMinor).toBe(0);
  });

  it('applies each band in turn', () => {
    // 2.2m at 15% = 330,000; 9m at 18% = 1,620,000; 1m at 21% = 210,000 → 2,160,000 on ₦13m.
    const tax = estimateIncomeTax({ yearlyIncomeMinor: naira(13_000_000) });
    expect(tax.yearlyTaxMinor).toBe(naira(2_160_000));
    expect(tax.topRateBps).toBe(2100);
    expect(tax.monthlyTaxMinor).toBe(naira(180_000));
  });

  it('takes rent relief off, capped at ₦500,000', () => {
    expect(estimateIncomeTax({ yearlyIncomeMinor: naira(3_000_000), yearlyRentMinor: naira(1_000_000) }).reliefMinor).toBe(naira(200_000));
    expect(estimateIncomeTax({ yearlyIncomeMinor: naira(30_000_000), yearlyRentMinor: naira(9_000_000) }).reliefMinor).toBe(naira(500_000));
  });
});
