import { describe, expect, it } from 'vitest';

import { buildCheckin, checkinWords } from './ayo-checkin';
import { EXPLAIN_TOPICS, explain } from './ayo-knowledge';
import { addDays, firstNameOf, monthsWords, NEVER_SAID, partOfDay, pick, plainWords, whenWords } from './ayo-voice';
import type { Nudge } from './ayo-nudges';
import type { StatementLine } from './statement';

const naira = (value: number) => value * 100;
const line = (date: string, direction: 'in' | 'out', amount: number, merchant: string, kind: StatementLine['kind']): StatementLine => ({
  date, description: merchant, merchant, kind, direction, amountMinor: naira(amount),
});

describe('the monthly check-in', () => {
  // Two months: pay of ₦400,000 each, transport doubling in the second.
  const lines: StatementLine[] = [line('2026-09-20', 'in', 400_000, 'Brightloop', 'income'), line('2026-10-20', 'in', 400_000, 'Brightloop', 'income')];
  for (let day = '2026-09-14'; day <= '2026-11-12'; day = addDays(day, 1)) {
    lines.push(line(day, 'out', 2_000, 'Market', 'food'));
    lines.push(line(day, 'out', day >= '2026-10-14' ? 2_000 : 1_000, 'Bolt', 'transport'));
  }

  it('adds up the last month and the one before, and finds what moved most', () => {
    const checkin = buildCheckin(lines, '2026-11-12')!;
    expect(checkin).toMatchObject({ from: '2026-10-14', to: '2026-11-12', inMinor: naira(400_000), outMinor: naira(120_000) });
    expect(checkin.before).toEqual({ inMinor: naira(400_000), outMinor: naira(90_000) });
    expect(checkin.biggestChange).toEqual({ kind: 'transport', nowMinor: naira(60_000), beforeMinor: naira(30_000) });
  });

  it('says it in a few sentences, with one thing to do', () => {
    const next: Nudge = { id: 'x', kind: 'idle-money', text: 'About ₦200,000 is sitting idle.', ask: 'Want me to move it to savings?', action: null };
    expect(checkinWords(buildCheckin(lines, '2026-11-12'), next)).toBe(
      'Over the last month, ₦400,000 came in and ₦120,000 went out. That\'s ₦30,000 more spent than the month before. Most of the change is transport, up from ₦30,000 to ₦60,000. One more thing. About ₦200,000 is sitting idle. Want me to move it to savings?',
    );
  });

  it('says what it needs rather than guess, with too little to go on', () => {
    expect(buildCheckin(lines.filter((each) => each.date >= '2026-11-01'), '2026-11-12')).toBeNull();
    expect(checkinWords(null, null)).toMatch(/^I need about a month/);
    const oneMonth = buildCheckin(lines.filter((each) => each.date >= '2026-10-10'), '2026-11-12')!;
    expect(oneMonth.before).toBeNull();
    expect(checkinWords(oneMonth, null)).toMatch(/Next month I can tell you what changed\.$/);
  });
});

describe('what Ayo explains', () => {
  it('has something checked for every topic, short enough to say, in product words', () => {
    for (const topic of EXPLAIN_TOPICS) {
      const words = explain(topic);
      expect(words.length, topic).toBeLessThan(400);
      expect(words, topic).not.toMatch(NEVER_SAID);
    }
  });

  it('reads the 2026 tax bands and rent relief from the one place they live', () => {
    expect(explain('tax')).toMatch(/the first ₦800,000 a year is free, the next ₦2,200,000 at 15%, the next ₦9,000,000 at 18%, the next ₦13,000,000 at 21%, the next ₦25,000,000 at 23%, anything above ₦50,000,000 at 25%/);
    expect(explain('rent-relief')).toMatch(/20% of a year's rent .* up to ₦500,000/);
  });

  it('is education, never a recommendation', () => {
    for (const topic of EXPLAIN_TOPICS) expect(explain(topic)).not.toMatch(/\byou should (?:buy|invest|sell)\b/i);
  });
});

describe('how Ayo sounds', () => {
  it('varies by turn, the same way every time', () => {
    expect(pick(['a', 'b', 'c'], 0)).toBe('a');
    expect(pick(['a', 'b', 'c'], 4)).toBe('b');
    expect(pick(['a', 'b', 'c'], -1)).toBe('b');
  });

  it('greets by the time in Lagos and the first name only', () => {
    expect(partOfDay(new Date('2026-11-13T06:00:00Z'))).toBe('Morning');
    expect(partOfDay(new Date('2026-11-13T12:30:00Z'))).toBe('Afternoon');
    expect(partOfDay(new Date('2026-11-13T22:00:00Z'))).toBe('Evening');
    expect(firstNameOf('Evan Ezedike')).toBe('Evan');
    expect(firstNameOf('  ')).toBeNull();
  });

  it('says days and months the way a person does', () => {
    expect(whenWords('2026-11-14', '2026-11-13')).toBe('tomorrow');
    expect(whenWords('2026-11-16', '2026-11-13')).toBe('in 3 days');
    expect(whenWords('2026-12-25', '2026-11-13')).toBe('on 25 December');
    expect(monthsWords(4.2)).toBe('about 4 months');
    expect(monthsWords(1.4)).toBe('about a month and a half');
    expect(monthsWords(0.6)).toBe('under a month');
  });

  it('keeps no picture, no forbidden word and nothing too long from a model', () => {
    expect(plainWords('New laptop 💻', 40)).toBe('New laptop');
    expect(plainWords('my crypto stash', 40)).toBeNull();
    expect(plainWords('a'.repeat(10) + ' ' + 'b'.repeat(40), 20)).toBe('aaaaaaaaaa');
  });
});
