import { describe, expect, it } from 'vitest';

import { asksPicture, planReply, tellAbout, tellAfford, type AssistantFacts } from './assistant-actions';
import { buildMoneyPicture } from './money-picture';
import type { StatementLine } from './statement';

const naira = (value: number) => value * 100;
const line = (date: string, direction: 'in' | 'out', amount: number, merchant: string, kind: StatementLine['kind']): StatementLine => ({
  date, description: merchant, merchant, kind, direction, amountMinor: naira(amount),
});
const lines: StatementLine[] = [];
for (const month of ['08', '09', '10']) {
  lines.push(line(`2026-${month}-25`, 'in', 600_000, 'Acme', 'income'));
  lines.push(line(`2026-${month}-01`, 'out', 150_000, 'Landlord', 'rent-home'));
  lines.push(line(`2026-${month}-05`, 'out', 4_400, 'Netflix', 'subscriptions'));
  for (let day = 10; day <= 20; day += 1) lines.push(line(`2026-${month}-${day}`, 'out', 2_000, 'Bolt', 'transport'));
}
const picture = buildMoneyPicture({ lines, balanceMinor: naira(2_000_000), today: '2026-10-26' });

const facts: AssistantFacts = {
  balanceMinor: 0, activity: [], allowances: [], savingsMinor: null, username: null, contactName: () => undefined,
  picture,
  pockets: [{ currency: 'USD', cents: 12_050, words: 'Dollars' }, { currency: 'EUR', cents: 0, words: 'Euros' }],
};

describe('Ayo on the money picture', () => {
  it('speaks only the person\'s own figures', () => {
    expect(tellAbout('safe-to-spend', facts)).toMatch(/^About ₦[\d,]+ a day is safe to spend until 25 November/);
    expect(tellAbout('subscriptions', facts)).toBe('You pay 1 subscription, ₦4,400 a month: Netflix.');
    expect(tellAbout('leaks', facts)).toMatch(/small payments added up to ₦[\d,]+.*Bolt/);
    expect(tellAbout('tax', facts)).toMatch(/estimate, not a filing/);
    expect(tellAbout('pockets', facts)).toBe('You hold $120.50.');
  });

  it('answers "can I afford it" from the picture, and says so when there is none', () => {
    expect(tellAfford(naira(100_000), picture)).toMatch(/^Yes\./);
    expect(tellAfford(naira(1_990_000), picture)).toMatch(/^Not right now\./);
    expect(tellAfford(naira(1_000), null)).toMatch(/read a bank statement/);
    expect(tellAbout('safe-to-spend', { ...facts, picture: null })).toMatch(/read a bank statement/);
  });

  it('opens Plan and says the answer', async () => {
    const steps = await planReply({ actions: [{ do: 'afford', amount: 100_000 }] }, { contacts: [], allowances: [], canSpend: false, paused: false }, facts, {
      directory: { resolve: async () => null } as never,
      resolveContactId: () => undefined,
    });
    expect(steps[0]).toEqual({ kind: 'open', screen: 'plan' });
    expect(steps[1]).toMatchObject({ kind: 'say' });
    expect(asksPicture({ actions: [{ do: 'tell', about: 'balance' }] })).toBe(false);
    expect(asksPicture({ actions: [{ do: 'afford', amount: 5 }] })).toBe(true);
  });
});
