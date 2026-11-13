import { describe, expect, it } from 'vitest';

import {
  changeMemory,
  dueReminders,
  MEMORY_MAX_ENTRIES,
  parseMemory,
  parsePreference,
  readMemory,
  resolveWhen,
  type MemoryEntry,
} from './ayo-memory';

const NOW = new Date('2026-11-13T09:00:00Z'); // a Friday
const TODAY = '2026-11-13';
const context = { now: NOW, today: TODAY, savingsMinor: 100_000_00 };

describe('when something falls, from what was said', () => {
  it.each([
    ['2026-12-01', '2026-12-01'],
    ['today', TODAY],
    ['tomorrow', '2026-11-14'],
    ['next tomorrow', '2026-11-15'],
    ['friday', '2026-11-20'], // today is Friday: the next one, not today
    ['on Monday', '2026-11-16'],
    ['next week', '2026-11-20'],
    ['in 3 days', '2026-11-16'],
    ['in two weeks', '2026-11-27'],
    ['end of the month', '2026-11-30'],
    ['the 25th', '2026-11-25'],
    ['the 5th', '2026-12-05'],
    ['March', '2027-03-31'],
    ['end of December', '2026-12-31'],
    ['by November', '2026-11-30'],
  ])('%s is %s', (said, day) => {
    expect(resolveWhen(said, TODAY)).toBe(day);
  });

  it('is nothing for a day gone, a day that does not exist, too far off, or words it does not know', () => {
    for (const said of ['2026-11-01', '2026-02-30', '2030-01-01', 'whenever', 'soon', '']) expect(resolveWhen(said, TODAY)).toBeNull();
  });
});

describe('preferences', () => {
  it('keeps only the fixed few, in the form they are kept', () => {
    expect(parsePreference('payday', '25')).toBe(25);
    expect(parsePreference('payday', 'the 1st')).toBe(1);
    expect(parsePreference('payday', '32')).toBeNull();
    expect(parsePreference('savings-share', '15%')).toBe(1500);
    expect(parsePreference('savings-share', '75')).toBeNull();
    expect(parsePreference('reply-style', 'Pidgin')).toBe('pidgin');
    expect(parsePreference('reply-style', 'french')).toBeNull();
  });

  it('the newest of each wins', () => {
    let entries: MemoryEntry[] = [];
    for (const value of ['10', '20']) {
      const outcome = changeMemory(entries, { kind: 'prefer', key: 'savings-share', value }, context);
      if (!outcome.ok) throw new Error('not kept');
      entries = outcome.entries;
    }
    expect(entries).toHaveLength(1);
    expect(readMemory(entries).savingsShareBps).toBe(2000);
  });
});

describe('goals', () => {
  it('keeps the amount said and the day resolved, and what savings held when it was set', () => {
    const outcome = changeMemory([], { kind: 'goal', name: 'New laptop', amountMinor: 400_000_00, by: 'March' }, context);
    expect(outcome).toMatchObject({ ok: true, kept: 'goal', goal: { name: 'New laptop', amountMinor: 400_000_00, by: '2027-03-31', savingsAtStartMinor: 100_000_00 } });
  });

  it('replaces a goal of the same name rather than adding a second', () => {
    const first = changeMemory([], { kind: 'goal', name: 'Rent', amountMinor: 1_000_00 }, context);
    if (!first.ok) throw new Error();
    const second = changeMemory(first.entries, { kind: 'goal', name: 'rent', amountMinor: 2_000_00 }, context);
    if (!second.ok) throw new Error();
    expect(readMemory(second.entries).goals).toHaveLength(1);
    expect(readMemory(second.entries).goals[0]!.amountMinor).toBe(2_000_00);
  });

  it('keeps no name with a forbidden word or nothing in it, and no day it cannot read', () => {
    expect(changeMemory([], { kind: 'goal', name: 'crypto bag', amountMinor: 1 }, context)).toEqual({ ok: false, why: 'bad-words' });
    expect(changeMemory([], { kind: 'goal', name: '🚀', amountMinor: 1 }, context)).toEqual({ ok: false, why: 'bad-words' });
    expect(changeMemory([], { kind: 'goal', name: 'Car', amountMinor: 1, by: 'someday' }, context)).toEqual({ ok: false, why: 'bad-when' });
  });
});

describe('reminders', () => {
  it('are kept with their day and come back when it arrives, until put away', () => {
    const outcome = changeMemory([], { kind: 'remind', what: 'pay the landlord', when: 'tomorrow' }, context);
    if (!outcome.ok || outcome.kept !== 'reminder') throw new Error();
    expect(outcome.reminder.due).toBe('2026-11-14');
    expect(dueReminders(readMemory(outcome.entries), TODAY)).toHaveLength(0);
    expect(dueReminders(readMemory(outcome.entries), '2026-11-14')).toHaveLength(1);
    const done = changeMemory(outcome.entries, { kind: 'dismiss', id: `reminder:${outcome.reminder.id}` }, context);
    if (!done.ok) throw new Error();
    expect(dueReminders(readMemory(done.entries), '2026-11-14')).toHaveLength(0);
  });
});

describe('forgetting', () => {
  const entries = (() => {
    let list: MemoryEntry[] = [];
    for (const change of [
      { kind: 'goal' as const, name: 'New laptop', amountMinor: 1 },
      { kind: 'goal' as const, name: 'Wedding', amountMinor: 1 },
      { kind: 'remind' as const, what: 'renew the laptop warranty', when: 'friday' },
      { kind: 'prefer' as const, key: 'payday' as const, value: '25' },
    ]) {
      const outcome = changeMemory(list, change, context);
      if (!outcome.ok) throw new Error();
      list = outcome.entries;
    }
    return list;
  })();

  it('lets go of the one thing named', () => {
    const outcome = changeMemory(entries, { kind: 'forget', what: 'the wedding goal' }, context);
    expect(outcome).toMatchObject({ ok: true, kept: 'forgot', names: ['Wedding'] });
    expect(changeMemory(entries, { kind: 'forget', what: 'my payday' }, context)).toMatchObject({ ok: true, names: ['payday'] });
  });

  it('asks which when more than one matches, and says so when nothing does', () => {
    expect(changeMemory(entries, { kind: 'forget', what: 'laptop' }, context)).toMatchObject({ ok: false, why: 'several' });
    expect(changeMemory(entries, { kind: 'forget', what: 'holiday' }, context)).toEqual({ ok: false, why: 'nothing-matches' });
  });
});

describe('the stored list', () => {
  it('reads back only what parses', () => {
    expect(parseMemory([{ kind: 'pref', key: 'payday', value: '25', at: NOW.toISOString() }, { kind: 'nonsense' }, 'x'])).toHaveLength(1);
    expect(parseMemory('not a list')).toEqual([]);
  });

  it('stays inside its limit, dropping the oldest put-away nudges first', () => {
    let list: MemoryEntry[] = [];
    for (let index = 0; index < 150; index += 1) {
      const outcome = changeMemory(list, { kind: 'dismiss', id: `n-${index}` }, context);
      if (!outcome.ok) throw new Error();
      list = outcome.entries;
    }
    expect(list.length).toBeLessThanOrEqual(MEMORY_MAX_ENTRIES);
    expect(readMemory(list).dismissed.has('n-0')).toBe(false);
    expect(readMemory(list).dismissed.has('n-149')).toBe(true);
    // A full list is far under a sealed record's 400 KB.
    expect(JSON.stringify(list).length * 2.2).toBeLessThan(400_000);
  });
});
