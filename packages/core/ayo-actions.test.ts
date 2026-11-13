import { describe, expect, it } from 'vitest';

import {
  answerOffer,
  assistantReplySchema,
  planReply,
  readAnswer,
  readPlainRequest,
  tellAbout,
  type AssistantAccount,
  type AssistantFacts,
  type AssistantReply,
  type AssistantStep,
} from './assistant-actions';
import { readMemory, type MemoryEntry } from './ayo-memory';
import { addDays } from './ayo-voice';
import { buildMoneyPicture } from './money-picture';
import type { StatementLine } from './statement';

const NOW = Date.parse('2026-11-13T08:00:00.000Z'); // Friday morning in Lagos
const account: AssistantAccount = { contacts: [], allowances: [], canSpend: false, paused: false };
const deps = { directory: { resolveByUsername: async () => null, resolveByPhone: async () => null }, now: () => NOW };
const facts = (overrides: Partial<AssistantFacts> = {}): AssistantFacts => ({
  balanceMinor: 50_000_000,
  activity: [],
  allowances: [],
  savingsMinor: 5_000_000,
  username: null,
  contactName: () => undefined,
  memory: [],
  displayName: 'Evan Ezedike',
  ...overrides,
});
const plan = (reply: AssistantReply, overrides: Partial<AssistantFacts> = {}) => planReply(reply, account, facts(overrides), deps);
const said = (steps: AssistantStep[]) => steps.flatMap((step) => (step.kind === 'say' ? [step.text] : [])).join(' ');
const kept = (steps: AssistantStep[]) => steps.find((step): step is Extract<AssistantStep, { kind: 'remember' }> => step.kind === 'remember')?.entries;

describe('the new vocabulary', () => {
  it('takes every new action in its shape and nothing outside it', () => {
    const good: AssistantReply['actions'] = [
      { do: 'goal', name: 'Laptop', amount: 400_000, by: 'march' },
      { do: 'prefer', key: 'payday', value: '25' },
      { do: 'remind', what: 'pay rent', when: 'friday' },
      { do: 'forget', what: 'laptop' },
      { do: 'checkin' },
      { do: 'explain', topic: 'tax' },
      { do: 'swap', from: 'usd', to: 'eur', amount: 100 },
      { do: 'add-to-pocket', pocket: 'gbp' },
      { do: 'tell', about: 'whats-new' },
    ];
    for (const action of good) expect(assistantReplySchema.safeParse({ actions: [action] }).success, JSON.stringify(action)).toBe(true);
    for (const bad of [
      { do: 'prefer', key: 'balance', value: '5' },
      { do: 'explain', topic: 'which stock to buy' },
      { do: 'swap', from: 'ngn', to: 'usd' },
      { do: 'goal', name: 'Car' },
      { do: 'remind', what: 'x'.repeat(81), when: 'today' },
    ]) {
      expect(assistantReplySchema.safeParse({ actions: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('what Ayo remembers', () => {
  it('keeps a goal with the amount said, says when it lands and what a month needs', async () => {
    const steps = await plan({ actions: [{ do: 'goal', name: 'Laptop', amount: 400_000, by: 'march' }] });
    expect(readMemory(kept(steps)!).goals[0]).toMatchObject({ name: 'Laptop', amountMinor: 40_000_000, by: '2027-03-31', savingsAtStartMinor: 5_000_000 });
    expect(said(steps)).toMatch(/^Got it: Laptop, ₦400,000 by 31 March\. That is about ₦[\d,]+ a month\. I will keep track\.$/);
  });

  it('builds on what was kept earlier in the same reply', async () => {
    const steps = await plan({ actions: [{ do: 'prefer', key: 'payday', value: '25th' }, { do: 'prefer', key: 'savings-share', value: '15' }] });
    const remembered = steps.filter((step) => step.kind === 'remember');
    expect(remembered).toHaveLength(2);
    expect(readMemory(kept([...remembered].reverse())!)).toMatchObject({ payday: 25, savingsShareBps: 1500 });
    expect(said(steps)).toBe('Okay, payday is the 25th. I will plan around it. Okay. When money comes in, I will offer 15% of it to savings.');
  });

  it('keeps a reminder for the day said, and is honest that it says it when the app is opened', async () => {
    const steps = await plan({ actions: [{ do: 'remind', what: 'pay the landlord', when: 'tomorrow' }] });
    expect(readMemory(kept(steps)!).reminders[0]).toMatchObject({ what: 'pay the landlord', due: '2026-11-14' });
    expect(said(steps)).toBe('Okay. I will bring it up when you open Entole tomorrow: pay the landlord.');
  });

  it('asks rather than keep a day or a value it cannot read', async () => {
    expect(said(await plan({ actions: [{ do: 'remind', what: 'x', when: 'someday' }] }))).toMatch(/^When should I remind you\?/);
    expect(said(await plan({ actions: [{ do: 'prefer', key: 'savings-share', value: '90' }] }))).toBe('Say a share between 1 and 50 percent.');
  });

  it('saves nothing, and says so, when what it remembers could not be read', async () => {
    const steps = await plan({ actions: [{ do: 'goal', name: 'Car', amount: 1_000_000 }] }, { memory: null });
    expect(kept(steps)).toBeUndefined();
    expect(said(steps)).toMatch(/nothing was saved/);
  });

  it('lets go of what is named, and says what', async () => {
    const first = await plan({ actions: [{ do: 'goal', name: 'Wedding', amount: 2_000_000 }] });
    const steps = await plan({ actions: [{ do: 'forget', what: 'the wedding' }] }, { memory: kept(first)! });
    expect(readMemory(kept(steps)!).goals).toHaveLength(0);
    expect(said(steps)).toBe('Done. I have let go of Wedding.');
  });

  it('reads goals and reminders back', async () => {
    const memory: MemoryEntry[] = [
      { kind: 'goal', id: 'g', name: 'Laptop', amountMinor: 40_000_000, by: '2027-03-31', createdAt: '2026-11-01T00:00:00.000Z', savingsAtStartMinor: 1_000_000 },
      { kind: 'reminder', id: 'r', what: 'renew DSTV', due: '2026-11-14', createdAt: '2026-11-01T00:00:00.000Z' },
    ];
    expect(tellAbout('goals', facts({ memory }), new Date(NOW))).toBe('Laptop: ₦40,000 of ₦400,000, by 31 March.');
    expect(tellAbout('reminders', facts({ memory }), new Date(NOW))).toBe('One reminder: renew DSTV, tomorrow.');
    expect(tellAbout('goals', facts(), new Date(NOW))).toMatch(/^You have not set a goal yet\./);
  });
});

describe('the friend', () => {
  const lines: StatementLine[] = [];
  for (const month of ['09', '10', '11']) lines.push({ date: `2026-${month}-11`, description: 'Brightloop', merchant: 'Brightloop', kind: 'income', direction: 'in', amountMinor: 50_000_000 });
  for (let day = '2026-09-01'; day <= '2026-11-12'; day = addDays(day, 1)) {
    lines.push({ date: day, description: 'Market', merchant: 'Market', kind: 'food', direction: 'out', amountMinor: 300_000 });
  }
  const picture = buildMoneyPicture({ lines, balanceMinor: 50_000_000, today: '2026-11-13' });

  it('does the monthly check-in from the lines and offers the one thing to do', async () => {
    const steps = await plan({ actions: [{ do: 'checkin' }] }, { lines, picture });
    expect(said(steps)).toMatch(/^Over the last month, ₦500,000 came in and ₦90,000 went out\. Spending was about the same as the month before\. One more thing\. Brightloop paid ₦500,000\. Want me to put ₦50,000 aside\?$/);
    expect(steps.at(-1)).toEqual({ kind: 'offer', step: { kind: 'savings', mode: 'deposit', amountMinor: 5_000_000 }, nudgeId: 'income:2026-11-11:brightloop' });
  });

  it('says what is new, the offer last so a yes answers it, and does not move the person', async () => {
    const steps = await plan({ actions: [{ do: 'tell', about: 'whats-new' }] }, { lines, picture });
    expect(steps.some((step) => step.kind === 'open')).toBe(false);
    expect(said(steps)).toMatch(/Brightloop paid ₦500,000\. Want me to put ₦50,000 aside\?$/);
    expect(steps.at(-1)).toMatchObject({ kind: 'offer' });
  });

  it('with nothing to say, says so plainly', async () => {
    expect(said(await plan({ actions: [{ do: 'tell', about: 'whats-new' }] }, { savingsMinor: null }))).toBe('Nothing needs you right now. You are all good.');
  });

  it('explains from what is written, not from the model', async () => {
    expect(said(await plan({ say: 'Tax is 50% for everyone.', actions: [{ do: 'explain', topic: 'tax' }] }))).toMatch(/^Under the Nigeria Tax Act, in force from January 2026, the first ₦800,000 a year is free/);
  });
});

describe('a yes or a no to an offer', () => {
  it('hears yes and no, in English and Pidgin, and nothing else', () => {
    for (const yes of ['yes', 'Yes please', 'okay do it', 'abeg do am', 'oya', 'go ahead!']) expect(readAnswer(yes), yes).toBe('yes');
    for (const no of ['no', 'not now', 'no thanks', 'leave am', 'no be now']) expect(readAnswer(no), no).toBe('no');
    for (const other of ['yes send 5k to Ada', 'what is my balance', 'no, save 10k instead']) expect(readAnswer(other), other).toBeNull();
  });

  it('a yes only opens what was offered, with the amount filled in: the person still confirms', () => {
    const offer = { step: { kind: 'savings' as const, mode: 'deposit' as const, amountMinor: 5_000_000 }, nudgeId: 'income:x' };
    expect(answerOffer('yes', offer)).toEqual([offer.step, { kind: 'say', text: 'Here is savings, with ₦50,000 filled in. You confirm what goes in.' }]);
  });

  it('a no keeps the nudge away from then on', () => {
    const steps = answerOffer('no', { step: { kind: 'open', screen: 'plan' }, nudgeId: 'renew:netflix:2026-11-15' }, { memory: [], now: new Date(NOW) });
    expect(readMemory(kept(steps)!).dismissed.has('renew:netflix:2026-11-15')).toBe(true);
    expect(said(steps)).toBe('Okay, I will leave it.');
  });
});

describe('pockets', () => {
  it('opens Change currency filled in, quoted first, for the person to confirm', async () => {
    const steps = await plan({ actions: [{ do: 'swap', from: 'usd', to: 'eur', amount: 100 }] });
    expect(steps).toEqual([
      { kind: 'say', text: 'Here is the change from dollars to euros, for $100.00. You will see the quote first, then you confirm it.' },
      { kind: 'swap', from: 'usd', to: 'eur', amountCents: 10_000 },
    ]);
    expect(said(await plan({ actions: [{ do: 'swap', from: 'gbp', to: 'gbp' }] }))).toMatch(/same currency/);
  });

  it('opens Add to a pocket', async () => {
    expect(await plan({ actions: [{ do: 'add-to-pocket', pocket: 'eur' }] })).toEqual([
      { kind: 'say', text: 'Here is Add to a pocket, for euros. Pick where it is coming from and you get a code to pay in.' },
      { kind: 'add-to-pocket', pocket: 'eur' },
    ]);
  });
});

describe('the plain grammar, for the new things it can be sure of', () => {
  it.each([
    ['monthly check-in', { do: 'checkin' }],
    ['give me my check in', { do: 'checkin' }],
    ["what's new", { do: 'tell', about: 'whats-new' }],
    ['my goals', { do: 'tell', about: 'goals' }],
    ['show my reminders', { do: 'tell', about: 'reminders' }],
  ])('%s', (text, action) => {
    expect(readPlainRequest(text)?.actions).toEqual([action]);
  });
});

describe('a pockets link', () => {
  it('opens the sheet asked for, filled in, and ignores what it does not know', async () => {
    const { pocketsOpeningFrom } = await import('./pockets-link');
    const read = (query: string) => {
      const params = new URLSearchParams(query);
      return pocketsOpeningFrom((key) => params.get(key));
    };
    expect(read('change=1&from=usd&to=eur&amount=10000')).toEqual({ sheet: 'change', from: 'usd', to: 'eur', amountCents: 10_000 });
    expect(read('change=1&from=ngn&to=usd&amount=-5')).toEqual({ sheet: 'change', to: 'usd' });
    expect(read('add=gbp')).toEqual({ sheet: 'add', pocket: 'gbp' });
    expect(read('add=1')).toEqual({ sheet: 'add' });
    expect(read('')).toBeNull();
  });
});
