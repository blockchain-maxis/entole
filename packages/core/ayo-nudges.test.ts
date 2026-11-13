import { describe, expect, it } from 'vitest';

import { changeMemory, EMPTY_MEMORY, readMemory, type MemoryEntry } from './ayo-memory';
import { addDays } from './ayo-voice';
import { buildNudges, goalProgress, openingLine, type NudgeInput } from './ayo-nudges';
import { buildMoneyPicture } from './money-picture';
import type { Invoice } from './schemas';
import type { StatementLine } from './statement';

const naira = (value: number) => value * 100;
const TODAY = '2026-11-13'; // a Friday; the week began Monday 9 November
const line = (date: string, direction: 'in' | 'out', amount: number, merchant: string, kind: StatementLine['kind']): StatementLine => ({
  date,
  description: merchant,
  merchant,
  kind,
  direction,
  amountMinor: naira(amount),
});

/** Three months and a bit: pay from Brightloop on the 11th, Netflix on the 15th, ₦3,000 of food a day until this week. */
function life(): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const month of ['08', '09', '10', '11']) lines.push(line(`2026-${month}-11`, 'in', 500_000, 'Brightloop', 'income'));
  for (const month of ['08', '09', '10']) lines.push(line(`2026-${month}-15`, 'out', 4_400, 'Netflix', 'subscriptions'));
  for (let day = '2026-08-01'; day <= '2026-11-09'; day = addDays(day, 1)) lines.push(line(day, 'out', 3_000, 'Chicken Republic', 'food'));
  return lines;
}

function input(overrides: Partial<NudgeInput> = {}): NudgeInput {
  const lines = overrides.lines ?? life();
  return {
    today: TODAY,
    lines,
    picture: buildMoneyPicture({ lines, balanceMinor: naira(500_000), today: TODAY }),
    balanceMinor: naira(500_000),
    savingsMinor: naira(50_000),
    invoices: [],
    memory: EMPTY_MEMORY,
    ...overrides,
  };
}

describe('nudges from the person\'s own figures', () => {
  it('puts what matters most first, at most three', () => {
    const nudges = buildNudges(input());
    expect(nudges.map((nudge) => nudge.kind)).toEqual(['income-landed', 'renewing-soon', 'under-usual']);
  });

  it('offers a share of pay that just landed, the share they chose or a tenth', () => {
    const [income] = buildNudges(input());
    expect(income).toMatchObject({
      text: 'Brightloop paid ₦500,000.',
      ask: 'Want me to put ₦50,000 aside?',
      action: { step: { kind: 'savings', mode: 'deposit', amountMinor: naira(50_000) } },
    });
    const chosen = changeMemory([], { kind: 'prefer', key: 'savings-share', value: '15' }, { now: new Date(), today: TODAY, savingsMinor: null });
    if (!chosen.ok) throw new Error();
    expect(buildNudges(input({ memory: readMemory(chosen.entries) }))[0]!.ask).toBe('Want me to put ₦75,000 aside?');
  });

  it('says when a subscription renews, with what it usually costs', () => {
    expect(buildNudges(input())[1]!.text).toBe('Netflix renews in 2 days, about ₦4,400. Still using it?');
  });

  it('offers the difference when this week runs under the usual, worked out from the weeks before', () => {
    const under = buildNudges(input())[2]!;
    expect(under.text).toMatch(/^You've spent ₦3,000 this week, about ₦[\d,]+ under your usual by now\.$/);
    expect(under.action?.step).toMatchObject({ kind: 'savings', mode: 'deposit' });
  });

  it('never brings back one they said no to', () => {
    const first = buildNudges(input())[0]!;
    const dismissed = changeMemory([], { kind: 'dismiss', id: first.id }, { now: new Date(), today: TODAY, savingsMinor: null });
    if (!dismissed.ok) throw new Error();
    expect(buildNudges(input({ memory: readMemory(dismissed.entries) })).map((nudge) => nudge.id)).not.toContain(first.id);
  });

  it('makes no nudge whose figures are missing: no savings, no offers to save', () => {
    const kinds = buildNudges(input({ savingsMinor: null })).map((nudge) => nudge.kind);
    expect(kinds).not.toContain('income-landed');
    expect(kinds).not.toContain('under-usual');
    expect(kinds).not.toContain('idle-money');
  });

  it('says nothing about this week from a statement that stops weeks ago', () => {
    const old = life().filter((each) => each.date <= '2026-10-20');
    const kinds = buildNudges(input({ lines: old, picture: buildMoneyPicture({ lines: old, balanceMinor: naira(500_000), today: TODAY }) })).map((nudge) => nudge.kind);
    expect(kinds).not.toContain('under-usual');
    expect(kinds).not.toContain('small-leaks');
    expect(kinds).not.toContain('income-landed');
  });

  it('with nothing read at all, makes nothing up', () => {
    expect(buildNudges(input({ lines: null, picture: null, savingsMinor: null }))).toEqual([]);
  });

  it('notices small payments running above the usual this week', () => {
    const lines = [...life().filter((each) => each.date < '2026-11-09')];
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) {
      for (let ride = 0; ride < 4; ride += 1) lines.push(line(day, 'out', 1_500, 'Bolt', 'transport'));
    }
    const picture = buildMoneyPicture({ lines, balanceMinor: naira(500_000), today: TODAY });
    const leak = buildNudges(input({ lines, picture, memory: EMPTY_MEMORY })).find((nudge) => nudge.kind === 'small-leaks');
    expect(leak?.text).toMatch(/^Small payments are at ₦24,000 this week, against about ₦[\d,]+ by now usually\. Most of it is Bolt\.$/);
  });

  it('says when an invoice is overdue and when a reminder is due, the reminder first', () => {
    const invoice = { id: 'inv-1', clientName: 'Acme', amountMinor: naira(80_000), note: 'Logo', dueAt: '2026-11-10T00:00:00.000Z', status: 'sent', link: '' } as Invoice;
    let memory: MemoryEntry[] = [];
    const reminded = changeMemory(memory, { kind: 'remind', what: 'call the landlord', when: 'today' }, { now: new Date('2026-11-13T08:00:00Z'), today: TODAY, savingsMinor: null });
    if (!reminded.ok) throw new Error();
    memory = reminded.entries;
    const nudges = buildNudges(input({ invoices: [invoice], memory: readMemory(memory), savingsMinor: null }));
    expect(nudges[0]!.text).toBe('You asked me to remind you today: call the landlord.');
    expect(nudges.find((nudge) => nudge.kind === 'invoice-overdue')?.text).toBe("Acme's invoice for ₦80,000 was due 3 days ago. A short reminder usually does it.");
  });

  it('is gentle about a thin buffer', () => {
    const lines = life();
    const picture = buildMoneyPicture({ lines, balanceMinor: naira(100_000), today: TODAY });
    const thin = buildNudges(input({ picture, balanceMinor: naira(100_000), savingsMinor: null })).find((nudge) => nudge.kind === 'runway-low');
    expect(thin?.text).toMatch(/^At your usual spending, what you have lasts (?:about a month|under a month|about a month and a half)\. Worth going a little easy until 11 December, when money usually comes in\.$/);
  });
});

describe('goals', () => {
  const goal = (by: string, createdAt = '2026-09-13T00:00:00.000Z') =>
    ({ kind: 'goal', id: 'g1', name: 'Laptop', amountMinor: naira(400_000), by, createdAt, savingsAtStartMinor: 0 }) as const;

  it('counts what was added to savings since the goal was set, against a straight line to its day', () => {
    expect(goalProgress(goal('2027-01-13'), naira(300_000), TODAY)).toMatchObject({ savedMinor: naira(300_000), onTrack: true });
    expect(goalProgress(goal('2027-01-13'), naira(100_000), TODAY)).toMatchObject({ savedMinor: naira(100_000), onTrack: false });
  });

  it('says how much a month gets a goal there when it is behind', () => {
    const nudges = buildNudges(input({ lines: null, picture: null, savingsMinor: naira(100_000), memory: readMemory([goal('2027-03-13')]) }));
    expect(nudges[0]!.text).toMatch(/^Laptop is a little behind: ₦100,000 of ₦400,000\. About ₦[\d,]+ a month gets you there by 13 March\.$/);
  });
});

describe('the opening line', () => {
  it('greets by first name and leads with the top nudge', () => {
    const [top] = buildNudges(input());
    expect(openingLine(top!, 'Evan Ezedike', new Date('2026-11-13T07:30:00Z'))).toBe('Morning, Evan. Brightloop paid ₦500,000. Want me to put ₦50,000 aside?');
  });

  it('without a nudge, says hello in more than one way', () => {
    const evening = new Date('2026-11-13T19:00:00Z');
    expect(openingLine(null, null, evening, 0)).toBe('Evening. What can I do for you?');
    expect(openingLine(null, 'Ada', evening, 1)).toBe('Evening, Ada. What do you need?');
  });
});
