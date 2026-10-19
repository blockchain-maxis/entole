import { describe, expect, it } from 'vitest';

import type { AllowanceView } from './allowance';
import {
  assistantReplySchema,
  findSavedPayee,
  koboFromDecimal,
  parseSpokenAmount,
  planPayment,
  planReply,
  readPlainRequest,
  tellAbout,
  type AssistantAccount,
  type AssistantFacts,
} from './assistant-actions';
import { kobo } from './money';
import { oneOffContact } from './one-off';
import type { Contact } from './schemas';

const ADA: Contact = { id: 'b-ada', name: 'Ada Eze', initials: 'AE', tone: 1 };
const MUM: Contact = { id: 'b-mum', name: 'Mum', initials: 'M', tone: 2 };
const ADA2: Contact = { id: 'b-ada2', name: 'Ada Obi', initials: 'AO', tone: 3 };

const allowance = (overrides: Partial<AllowanceView> = {}): AllowanceView =>
  ({
    id: 'a-mum',
    name: 'Mum',
    recipientId: 'b-mum',
    remainingMinor: 30_000_00,
    limitMinor: 50_000_00,
    spentMinor: 20_000_00,
    remainingFraction: 0.6,
    usedPercent: 40,
    tone: 'ok',
    paused: false,
    perRunMinor: 50_000_00,
    cadence: 'monthly',
    resetsAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }) as AllowanceView;

const nobodyHome = { resolveByUsername: async () => null, resolveByPhone: async () => null };
const TUNDE = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01';
const directory = {
  resolveByUsername: async (username: string) =>
    username === 'tunde_b' ? { address: TUNDE, name: 'Tunde Bello', initials: 'TB', tone: 1 as const, username } : null,
  resolveByPhone: async () => null,
};

const account = (overrides: Partial<AssistantAccount> = {}): AssistantAccount => ({
  contacts: [ADA, MUM],
  allowances: [],
  canSpend: false,
  paused: false,
  ...overrides,
});

describe('an amount as a person says it', () => {
  it.each([
    ['5000', 5000],
    ['5,000', 5000],
    ['₦5,000', 5000],
    ['5k', 5000],
    ['2.5k', 2500],
    ['1.5m', 1_500_000],
    ['5 thousand', 5000],
    ['5000 naira', 5000],
    ['N2,500.50', 2500.5],
  ])('%s is %d naira', (said, amount) => {
    expect(parseSpokenAmount(said)).toBe(amount);
  });

  it.each(['', 'five', '0', '-5', 'abc', '5kk', '12 apples'])('%s is not an amount', (said) => {
    expect(parseSpokenAmount(said)).toBeNull();
  });

  it('is not an amount when it is more than a billion naira', () => {
    expect(parseSpokenAmount('1,000,000,000')).toBe(1_000_000_000);
    expect(parseSpokenAmount('1,000,000,000.01')).toBeNull();
    expect(parseSpokenAmount('1001m')).toBeNull();
  });
});

describe('koboFromDecimal: naira as whole kobo, worked out on the digits', () => {
  it.each([
    ['2500', 1, 250_000],
    ['2500.5', 1, 250_050],
    ['0.75', 1, 75],
    ['0.29', 1, 29],
    ['2.5', 1_000, 250_000],
    ['1.15', 1_000, 115_000],
    ['1.5', 1_000_000, 150_000_000],
    ['19.99', 1, 1_999],
  ])('%s × %d is %d kobo', (text, scale, inKobo) => {
    expect(koboFromDecimal(text, scale)).toBe(inKobo);
  });

  it('gets right what multiplying by a hundred gets wrong', () => {
    // 1.005 × 100 is 100.49999999999999 as a float, which rounds down.
    expect(Math.round(1.005 * 100)).toBe(100);
    expect(koboFromDecimal('1.005')).toBe(101);
    // 1.255 × 100 is 125.49999999999999.
    expect(Math.round(1.255 * 100)).toBe(125);
    expect(koboFromDecimal('1.255')).toBe(126);
  });

  it('rounds half a kobo up and less than half down', () => {
    expect(koboFromDecimal('0.005')).toBe(1);
    expect(koboFromDecimal('0.0049')).toBe(0);
    expect(koboFromDecimal('12.344')).toBe(1_234);
  });

  it.each(['', '5k', '1e3', '-5', '5.', '.5', '1,000', ' 5', 'NaN'])('%s is not a plain decimal', (text) => {
    expect(koboFromDecimal(text)).toBeNull();
  });

  it('refuses a figure too large to hold exactly', () => {
    expect(koboFromDecimal('99999999999999999999')).toBeNull();
  });
});

describe('the plain grammar reads what can only mean one thing', () => {
  it.each([
    ['Send 5,000 to Ada for rent', { do: 'pay', to: 'Ada', amount: 5000, note: 'rent' }],
    ['pay 5k to @tunde_b', { do: 'pay', to: '@tunde_b', amount: 5000 }],
    ['Pay Mum 2.5k for the generator.', { do: 'pay', to: 'Mum', amount: 2500, note: 'the generator' }],
    ['please send ₦1,000 to 0803 123 4567', { do: 'pay', to: '0803 123 4567', amount: 1000 }],
    ['pay Ada', { do: 'pay', to: 'Ada' }],
    ['open receive', { do: 'open', screen: 'receive' }],
    ['Go to my savings', { do: 'open', screen: 'savings' }],
    ['show me my activity', { do: 'open', screen: 'activity' }],
    ["What's my balance?", { do: 'tell', about: 'balance' }],
    ['how much do I have', { do: 'tell', about: 'balance' }],
    ['my last payments', { do: 'tell', about: 'recent' }],
    ['request 20k', { do: 'request', amount: 20000 }],
    ['save 10,000 in my savings', { do: 'save', amount: 10000 }],
    ['withdraw 5000 from savings', { do: 'take-out', amount: 5000 }],
    ['pause the assistant', { do: 'pause' }],
    ['resume assistant', { do: 'resume' }],
  ])('%s', (said, action) => {
    expect(readPlainRequest(said)).toEqual({ actions: [action] });
  });

  it.each([
    ['send money', { do: 'open', screen: 'send' }],
    ['I want to send money', { do: 'open', screen: 'send' }],
    ['let me pay someone', { do: 'open', screen: 'send' }],
    ['take me home', { do: 'open', screen: 'home' }],
    ['go home', { do: 'open', screen: 'home' }],
    ['show my balance', { do: 'tell', about: 'balance' }],
    ['how much do I have', { do: 'tell', about: 'balance' }],
    ['Hey Ayo, what is my balance', { do: 'tell', about: 'balance' }],
    ['hey ayo send 5000 to Ada', { do: 'pay', to: 'Ada', amount: 5000 }],
    ['Ayo open receive', { do: 'open', screen: 'receive' }],
  ])('"%s" is read without a model', (said, action) => {
    expect(readPlainRequest(said)).toEqual({ actions: [action] });
  });

  it('five k is five thousand, never five naira', () => {
    expect(readPlainRequest('pay 5k to Ada')!.actions[0]).toMatchObject({ amount: 5000 });
  });

  it.each([
    '',
    'send 5000 to ada and 3000 to tunde',
    'open the pod bay doors',
    'what is the weather',
  ])('stays quiet about "%s" rather than guess', (said) => {
    expect(readPlainRequest(said)).toBeNull();
  });

  it('only ever answers in the fixed vocabulary', () => {
    for (const said of ['Send 5,000 to Ada for rent', 'open receive', 'balance']) {
      expect(assistantReplySchema.safeParse(readPlainRequest(said)).success).toBe(true);
    }
    expect(assistantReplySchema.safeParse({ actions: [{ do: 'confirm' }] }).success).toBe(false);
    expect(assistantReplySchema.safeParse({ actions: [{ do: 'pay', to: 'Ada', amount: -5 }] }).success).toBe(false);
  });
});

describe('bills, read before people', () => {
  it.each([
    ['pay my light bill', { do: 'bill', kind: 'electricity' }],
    ['pay dstv 5k', { do: 'bill', kind: 'cable-tv', amount: 5000 }],
    ['Buy 1000 airtime', { do: 'bill', kind: 'airtime-data', amount: 1000 }],
    ['pay 10k for light', { do: 'bill', kind: 'electricity', amount: 10000 }],
    ['top up my data', { do: 'bill', kind: 'airtime-data' }],
    ['renew my gotv subscription', { do: 'bill', kind: 'cable-tv' }],
    ['pay spectranet 15,000 naira', { do: 'bill', kind: 'internet', amount: 15000 }],
  ])('%s', (said, action) => {
    expect(readPlainRequest(said)).toEqual({ actions: [action] });
  });

  it('leaves a person called anything else to the payment grammar', () => {
    expect(readPlainRequest('pay Ada 5k')).toEqual({ actions: [{ do: 'pay', to: 'Ada', amount: 5000 }] });
    expect(readPlainRequest('send 5000 to Mum for light')).toEqual({
      actions: [{ do: 'pay', to: 'Mum', amount: 5000, note: 'light' }],
    });
  });
});

describe('who a spoken name is', () => {
  it('finds one saved person by full name, first name or "my mum"', () => {
    expect(findSavedPayee('ada eze', [ADA, MUM])).toEqual({ kind: 'saved', contact: ADA });
    expect(findSavedPayee('Ada', [ADA, MUM])).toEqual({ kind: 'saved', contact: ADA });
    expect(findSavedPayee('my mum', [ADA, MUM])).toEqual({ kind: 'saved', contact: MUM });
  });

  it('asks when two people answer to the name, and never picks one', () => {
    expect(findSavedPayee('ada', [ADA, ADA2, MUM])).toEqual({ kind: 'several', names: ['Ada Eze', 'Ada Obi'] });
  });

  it('a username or a number that is nobody saved is one to look up', () => {
    expect(findSavedPayee('@tunde_b', [ADA])).toEqual({ kind: 'look-up' });
    expect(findSavedPayee('0803 123 4567', [ADA])).toEqual({ kind: 'look-up' });
    expect(findSavedPayee('uncle from lagos', [ADA])).toEqual({ kind: 'nobody' });
  });
});

describe('what paying someone means right now', () => {
  const pay = { do: 'pay' as const, to: 'Mum', amount: 5000, note: 'rent' };

  it('with no allowance, it gets Send ready and leaves the confirming to the person', async () => {
    const steps = await planPayment(pay, account(), { directory: nobodyHome });
    expect(steps[0]).toEqual({ kind: 'send', contactId: 'b-mum', amountMinor: 500_000, note: 'rent' });
    expect(steps[1]).toEqual({ kind: 'say', text: 'Mum, ₦5,000. Check it, then confirm it yourself.' });
    expect(steps.some((step) => step.kind === 'propose')).toBe(false);
  });

  it('inside an allowance it may spend, the payment is the assistant’s, with an undo window', async () => {
    const steps = await planPayment(pay, account({ canSpend: true, allowances: [allowance()] }), {
      directory: nobodyHome,
      now: () => 1000,
    });
    expect(steps[0]).toMatchObject({
      kind: 'propose',
      proposal: { allowanceId: 'a-mum', contactId: 'b-mum', amountMinor: 500_000, note: 'rent', undoSeconds: 10 },
    });
    expect(steps[1]).toMatchObject({ kind: 'say' });
  });

  it.each([
    ['the assistant has not been turned on to spend', { canSpend: false, allowances: [allowance()] }],
    ['the assistant is paused', { canSpend: true, paused: true, allowances: [allowance()] }],
    ['the allowance is paused', { canSpend: true, allowances: [allowance({ paused: true })] }],
    ['it is more than the allowance has left', { canSpend: true, allowances: [allowance({ remainingMinor: kobo(100_00) })] }],
    ['the allowance is for someone else', { canSpend: true, allowances: [allowance({ recipientId: 'b-ada' })] }],
  ])('when %s, the person confirms it themselves', async (_why, overrides) => {
    const steps = await planPayment(pay, account(overrides), { directory: nobodyHome });
    expect(steps[0]).toMatchObject({ kind: 'send', contactId: 'b-mum' });
  });

  it('finds someone not saved by username, and names them as the directory does', async () => {
    const steps = await planPayment({ do: 'pay', to: '@tunde_b', amount: 1000 }, account(), { directory });
    expect(steps[0]).toMatchObject({ kind: 'send', amountMinor: 100_000 });
    const contactId = (steps[0] as { contactId: string }).contactId;
    expect(oneOffContact(contactId)?.name).toBe('Tunde Bello');
    expect(steps[1]).toEqual({ kind: 'say', text: 'Tunde Bello, ₦1,000. Check it, then confirm it yourself.' });
  });

  it('uses the saved record when the person looked up is already saved', async () => {
    const steps = await planPayment({ do: 'pay', to: '@tunde_b', amount: 1000 }, account(), {
      directory,
      resolveContactId: () => 'b-tunde',
    });
    expect(steps[0]).toMatchObject({ kind: 'send', contactId: 'b-tunde' });
  });

  it('says so, and does nothing, when it cannot tell who is meant', async () => {
    expect(await planPayment({ do: 'pay', to: '@nobody', amount: 5 }, account(), { directory })).toEqual([
      { kind: 'say', text: "I couldn't find @nobody on Entole. Check the username or number." },
    ]);
    expect(await planPayment({ do: 'pay', to: 'uncle from lagos', amount: 5 }, account(), { directory })).toEqual([
      { kind: 'say', text: "I don't know who uncle from lagos is. Say their username or their phone number." },
    ]);
    expect(
      await planPayment({ do: 'pay', to: 'ada', amount: 5 }, account({ contacts: [ADA, ADA2] }), { directory }),
    ).toEqual([{ kind: 'say', text: 'You have saved Ada Eze and Ada Obi. Which one?' }]);
  });

  it('with no amount, it opens Send on the person and asks for the amount', async () => {
    const steps = await planPayment({ do: 'pay', to: 'Mum' }, account(), { directory: nobodyHome });
    expect(steps).toEqual([
      { kind: 'send', contactId: 'b-mum' },
      { kind: 'say', text: 'Here is Mum. Enter the amount, then confirm it yourself.' },
    ]);
  });
});

describe('figures are the app’s own, never the reader’s', () => {
  const facts: AssistantFacts = {
    balanceMinor: 1_250_072,
    activity: [
      { id: '1', contactId: 'b-ada', note: 'Rent', at: '2026-10-12T19:54:00.000Z', amountMinor: 250_000, direction: 'in', initiatedBy: 'you', state: 'settled' },
      { id: '2', contactId: 'b-mum', note: 'Upkeep', at: '2026-10-11T09:00:00.000Z', amountMinor: 500_000, direction: 'out', initiatedBy: 'assistant', state: 'settled' },
    ],
    allowances: [allowance()],
    savingsMinor: null,
    username: 'that_guy',
    contactName: (id) => (id === 'b-ada' ? 'Ada Eze' : id === 'b-mum' ? 'Mum' : undefined),
  };
  const now = new Date('2026-10-12T20:00:00.000Z');

  it('says the balance, the username, savings and what the assistant may spend', () => {
    expect(tellAbout('balance', facts)).toBe('You have ₦12,500.72.');
    expect(tellAbout('username', facts)).toBe('Your username is @that_guy.');
    expect(tellAbout('savings', facts)).toBe('There is nothing in savings yet.');
    expect(tellAbout('allowances', facts)).toBe('Mum: ₦30,000 left of ₦50,000.');
  });

  it('says what moved, who with, and which were the assistant’s', () => {
    const said = tellAbout('recent', facts, now);
    expect(said).toContain('Ada Eze sent you ₦2,500');
    expect(said).toContain('The assistant sent ₦5,000 to Mum');
    expect(tellAbout('recent', { ...facts, activity: [] })).toBe('Nothing has moved in or out yet.');
  });

  it('a reply that asks for a fact is answered from the app, whatever the reader wrote', async () => {
    const steps = await planReply(
      { say: 'You have ₦9,999,999.', actions: [{ do: 'tell', about: 'balance' }] },
      account(),
      facts,
      { directory: nobodyHome },
    );
    // Asking for a fact takes the person to where it lives, and says the real figure.
    expect(steps).toEqual([
      { kind: 'open', screen: 'home' },
      { kind: 'say', text: 'You have ₦12,500.72.' },
    ]);
  });

  it('only says a fact, and does not move the person, when they are part-way through something', async () => {
    const steps = await planReply(
      { actions: [{ do: 'tell', about: 'balance' }] },
      account(),
      facts,
      { directory: nobodyHome, stay: true },
    );
    expect(steps).toEqual([{ kind: 'say', text: 'You have ₦12,500.72.' }]);
  });

  it.each([
    ['balance', 'home'],
    ['recent', 'activity'],
    ['allowances', 'home'],
    ['savings', 'savings'],
    ['username', 'receive'],
  ] as const)('a question about %s opens %s', async (about, screen) => {
    const steps = await planReply({ actions: [{ do: 'tell', about }] }, account(), facts, { directory: nobodyHome });
    expect(steps[0]).toEqual({ kind: 'open', screen });
  });

  it('opens screens, and says the reader’s words only when the app has none of its own', async () => {
    const steps = await planReply(
      { say: 'Here is where you get paid.', actions: [{ do: 'open', screen: 'receive' }] },
      account(),
      facts,
      { directory: nobodyHome },
    );
    expect(steps).toEqual([
      { kind: 'say', text: 'Here is where you get paid.' },
      { kind: 'open', screen: 'receive' },
    ]);
  });

  it('says where it is taking you when the reader had nothing to say', async () => {
    const steps = await planReply({ actions: [{ do: 'open', screen: 'add-money' }] }, account(), facts, {
      directory: nobodyHome,
    });
    expect(steps).toEqual([
      { kind: 'say', text: 'Opening Add money.' },
      { kind: 'open', screen: 'add-money' },
    ]);
    const asking = await planReply({ actions: [{ do: 'request', amount: 2000 }] }, account(), facts, {
      directory: nobodyHome,
    });
    expect(asking[0]).toEqual({ kind: 'say', text: 'Here is your link, asking for ₦2,000.' });
  });

  it('turns the rest into steps the app carries out', async () => {
    const steps = await planReply(
      { actions: [{ do: 'request', amount: 2000 }, { do: 'save', amount: 500 }, { do: 'pause' }] },
      account(),
      facts,
      { directory: nobodyHome },
    );
    expect(steps.filter((step) => step.kind !== 'say')).toEqual([
      { kind: 'request', amountMinor: 200_000 },
      { kind: 'savings', mode: 'deposit', amountMinor: 50_000 },
      { kind: 'pause', paused: true },
    ]);
  });

  it('opens a bill with its kind and amount, so the screen can be filled in', async () => {
    const steps = await planReply(readPlainRequest('pay dstv 5k')!, account(), facts, { directory: nobodyHome });
    expect(steps).toEqual([
      { kind: 'say', text: 'Here is that bill, for ₦5,000. Add the account number, then confirm it yourself.' },
      { kind: 'bill', category: 'cable-tv', amountMinor: 500_000 },
    ]);
  });

  it('turns a figure with kobo into whole kobo exactly, whoever read it', async () => {
    const amounts = async (reply: unknown) =>
      (await planReply(assistantReplySchema.parse(reply), account(), facts, { directory: nobodyHome }))
        .filter((step) => step.kind === 'request')
        .map((step) => (step as { amountMinor?: number }).amountMinor);

    // As a model writes it: a number in naira.
    expect(await amounts({ actions: [{ do: 'request', amount: 1.005 }] })).toEqual([101]);
    expect(await amounts({ actions: [{ do: 'request', amount: 2500.5 }] })).toEqual([250_050]);
    // As the plain grammar reads it.
    expect(await amounts(readPlainRequest('request 8.345'))).toEqual([835]);
    expect(await amounts(readPlainRequest('request 2.5k'))).toEqual([250_000]);
    // Too small to be a kobo: no amount, not an amount of nothing.
    expect(await amounts({ actions: [{ do: 'request', amount: 0.001 }] })).toEqual([undefined]);
  });
});

describe('talking to it, with no model', () => {
  it.each([
    ['hello', /^Hello/],
    ['Hey Ayo', /^Hello/],
    ['good morning', /^Hello/],
    ['how are you', /good, thank you/],
    ['thank you', /welcome/],
    ['thanks!', /welcome/],
    ['who are you', /I’m Ayo/],
    ['what can you do', /open any screen/],
    ['help', /open any screen/],
    ['bye', /Alright/],
  ])('"%s" is answered at once, with words and no action', (said, answer) => {
    const reply = readPlainRequest(said);
    expect(reply?.actions).toEqual([]);
    expect(reply?.say).toMatch(answer);
  });

  it('is turned into something to say, not into nothing', async () => {
    const reply = readPlainRequest('thank you')!;
    const noFacts: AssistantFacts = {
      balanceMinor: 0,
      activity: [],
      allowances: [],
      savingsMinor: null,
      username: null,
      contactName: () => undefined,
    };
    const steps = await planReply(reply, account(), noFacts, { directory: nobodyHome });
    expect(steps).toEqual([{ kind: 'say', text: 'You’re welcome.' }]);
  });

  it('does not answer a request as if it were a greeting', () => {
    expect(readPlainRequest('send 5000 to Ada')?.say).toBeUndefined();
    expect(readPlainRequest('hello can you send money to Ada for me please')).toBeNull();
  });

  it('never says a word the product never says', () => {
    const never = /\b(wallet|crypto\w*|blockchain|on-?chain|chain|gas|token|signature)\b/i;
    for (const said of ['hello', 'how are you', 'thank you', 'who are you', 'what can you do', 'bye']) {
      expect(readPlainRequest(said)?.say).not.toMatch(never);
    }
  });
});


describe('finding someone by what the owner calls them', () => {
  const contacts = [
    { id: 'c1', name: 'Ngozi Okafor', nickname: 'Mum', initials: 'NO', tone: 1 },
    { id: 'c2', name: 'Tunde Bello', initials: 'TB', tone: 2 },
  ] as never;

  it('finds Ngozi Okafor when asked for "mum", and says her name', () => {
    expect(findSavedPayee('mum', contacts)).toMatchObject({ kind: 'saved', contact: { id: 'c1', name: 'Ngozi Okafor' } });
    expect(findSavedPayee('my mum', contacts)).toMatchObject({ kind: 'saved', contact: { id: 'c1' } });
  });

  it('still finds a person by their name', () => {
    expect(findSavedPayee('Tunde', contacts)).toMatchObject({ kind: 'saved', contact: { id: 'c2' } });
    expect(findSavedPayee('Ngozi', contacts)).toMatchObject({ kind: 'saved', contact: { id: 'c1' } });
  });
});


describe('finding someone said the way a recogniser writes them', () => {
  const contacts = [
    { id: 'c1', name: 'Adaeze Okafor', nickname: 'Mum', initials: 'AO', tone: 1 },
    { id: 'c2', name: 'Chukwuemeka Obi', initials: 'CO', tone: 2 },
    { id: 'c3', name: 'Tunde Bello', initials: 'TB', tone: 3 },
  ] as never;

  it.each([
    ['a day zay', 'c1'],
    ['adaeze okafo', 'c1'],
    ['chuck wemeka', 'c2'],
    ['chukwu emeka obi', 'c2'],
    ['tonde', 'c3'],
  ])('"%s" is found', (heard, id) => {
    expect(findSavedPayee(heard, contacts)).toMatchObject({ kind: 'saved', contact: { id } });
  });

  it('does not turn a stranger into someone saved', () => {
    expect(findSavedPayee('Olamide', contacts)).not.toMatchObject({ kind: 'saved' });
  });

  it('pays the right person when it was said that way', async () => {
    const steps = await planPayment({ do: 'pay', to: 'a day zay', amount: 5000 }, account({ contacts }), { directory: nobodyHome });
    expect(steps[0]).toMatchObject({ kind: 'send', contactId: 'c1', amountMinor: 500_000 });
    expect(steps[1]).toMatchObject({ kind: 'say', text: expect.stringContaining('Adaeze Okafor') });
  });
});
