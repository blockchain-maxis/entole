import { z } from 'zod';

import type { AllowanceView } from './allowance';
import { ASK_UNDO_SECONDS } from './assistant-ask';
import { withoutName } from './assistant-persona';
import { buildCheckin, checkinWords } from './ayo-checkin';
import { EXPLAIN_TOPICS, explain } from './ayo-knowledge';
import { changeMemory, EMPTY_MEMORY, PREFERENCE_KEYS, readMemory, type MemoryEntry, type ReplyStyle } from './ayo-memory';
import { buildNudges, goalProgress, nudgeLine, type Nudge } from './ayo-nudges';
import { dayWords, firstNameOf, lagosToday, monthsWords, pick, whenWords } from './ayo-voice';
import { bestNameMatch } from './nigerian-names';
import { relativeMoment } from './format';
import type { HandleDirectory } from './handle';
import { formatPocketAmount, POCKETS, type PocketCurrency, type PocketId } from './intents-pockets';
import { affordCheck, type MoneyPicture } from './money-picture';
import { formatNaira, kobo } from './money';
import { oneOffId } from './one-off';
import { findRecipient, readRecipient } from './recipient';
import type { Activity, Contact, Invoice, Proposal } from './schemas';
import type { StatementLine } from './statement';

/**
 * What the assistant can do in the app, and how a sentence becomes it.
 *
 * The assistant is someone you talk to who works the app for you. It opens
 * screens, picks the person, fills in the amount, and tells you things. What
 * it cannot do is confirm: anything that moves your money ends at your own
 * fingerprint or passkey, which no code can answer. The one exception is the
 * one you wrote yourself: a payment inside an allowance, which waits out its
 * undo window and is then held to its limit by the contract.
 *
 * Three rules shape this file.
 *
 * 1. A fixed vocabulary. Whatever reads the sentence, a language model or the
 *    plain grammar below, can only answer in the actions listed here. Anything
 *    else it says is thrown away before the app sees it.
 * 2. The reader never sees your money. It is given your words and nothing
 *    about your account. When you ask what your balance is, it answers "tell
 *    them the balance" and the app says the figure, from its own books. So a
 *    figure the assistant speaks is always the real one.
 * 3. Names are matched here, on the device. The reader hands back "mum" as you
 *    said it; who that is among the people you saved is worked out here.
 */

/** Every screen the assistant can open. Each app maps these to its own routes. */
export const ASSISTANT_SCREENS = [
  'home',
  'pay',
  'send',
  'receive',
  'add-money',
  'activity',
  'savings',
  'stocks',
  'bills',
  'business',
  'invoice',
  'people',
  'new-allowance',
  'assistant',
  'me',
  'money',
  'plan',
] as const;

export type AssistantScreen = (typeof ASSISTANT_SCREENS)[number];

/** What each screen is called when the assistant says where it is taking you. */
const SCREEN_NAMES: Record<AssistantScreen, string> = {
  home: 'Home',
  pay: 'Pay',
  send: 'Send',
  receive: 'Receive',
  'add-money': 'Add money',
  activity: 'your activity',
  savings: 'your savings',
  stocks: 'Stocks',
  bills: 'Bills',
  business: 'Business',
  invoice: 'a new invoice',
  people: 'your beneficiaries',
  'new-allowance': 'a new allowance',
  assistant: 'the assistant',
  me: 'your profile',
  money: 'Money',
  plan: 'your plan',
};

/** Facts the app can say. The figures come from its own books, never the reader. */
export const TELL_ABOUT = [
  'balance',
  'recent',
  'allowances',
  'savings',
  'username',
  'safe-to-spend',
  'leaks',
  'subscriptions',
  'picture',
  'tax',
  'pockets',
  'goals',
  'reminders',
  'whats-new',
] as const;

/** The pockets a currency change or a top-up can name. */
const POCKET_NAMES = ['usd', 'eur', 'gbp'] as const satisfies readonly PocketId[];

/** Whole naira, as a person says it. Kobo are worked out here, never by the reader. */
const spokenAmount = z.number().positive().max(1_000_000_000);

export const assistantActionSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('open'), screen: z.enum(ASSISTANT_SCREENS) }),
  /** Set up a payment to someone: a saved name, a username or a phone number. */
  z.object({
    do: z.literal('pay'),
    to: z.string().trim().min(1).max(60),
    amount: spokenAmount.optional(),
    note: z.string().trim().max(80).optional(),
  }),
  /** Show how to be paid, optionally asking for an amount. */
  z.object({ do: z.literal('request'), amount: spokenAmount.optional() }),
  z.object({ do: z.literal('save'), amount: spokenAmount.optional() }),
  z.object({ do: z.literal('take-out'), amount: spokenAmount.optional() }),
  z.object({
    do: z.literal('bill'),
    kind: z.enum(['electricity', 'airtime-data', 'cable-tv', 'internet']).optional(),
    amount: spokenAmount.optional(),
  }),
  /** Say something the app knows. The app supplies the facts, never the reader. */
  z.object({ do: z.literal('tell'), about: z.enum(TELL_ABOUT) }),
  /** "Can I afford ₦200k?" The app answers from the person's own money picture. */
  z.object({ do: z.literal('afford'), amount: spokenAmount }),
  z.object({ do: z.literal('pause') }),
  z.object({ do: z.literal('resume') }),
  /** Something they are saving towards: a name, the amount they said, and by when if they said. */
  z.object({
    do: z.literal('goal'),
    name: z.string().trim().min(1).max(40),
    amount: spokenAmount,
    by: z.string().trim().min(1).max(30).optional(),
  }),
  /** One of a fixed few preferences: payday (day of the month), savings-share (a percentage), reply-style. */
  z.object({ do: z.literal('prefer'), key: z.enum(PREFERENCE_KEYS), value: z.string().trim().min(1).max(20) }),
  /** A reminder, said back when the app is opened on the day. "when" is resolved on the device. */
  z.object({ do: z.literal('remind'), what: z.string().trim().min(1).max(80), when: z.string().trim().min(1).max(30) }),
  z.object({ do: z.literal('forget'), what: z.string().trim().min(1).max(60) }),
  /** The monthly check-in, worked out on the device from their own lines. */
  z.object({ do: z.literal('checkin') }),
  /** How something works, from a fixed, checked set of explanations. Never advice. */
  z.object({ do: z.literal('explain'), topic: z.enum(EXPLAIN_TOPICS) }),
  /** Change between currency pockets: the sheet opens filled in, quoted first, confirmed by the person. Amount in the "from" currency. */
  z.object({
    do: z.literal('swap'),
    from: z.enum(POCKET_NAMES),
    to: z.enum(POCKET_NAMES),
    amount: z.number().positive().max(10_000_000).optional(),
  }),
  z.object({ do: z.literal('add-to-pocket'), pocket: z.enum(POCKET_NAMES).optional() }),
]);

export type AssistantAction = z.infer<typeof assistantActionSchema>;

/** What a reader hands back: a few words to say, and at most a few things to do. */
export const assistantReplySchema = z.object({
  say: z.string().trim().max(300).optional(),
  actions: z.array(assistantActionSchema).max(3),
});

export type AssistantReply = z.infer<typeof assistantReplySchema>;

// ---------------------------------------------------------------------------
// The plain grammar: works with no model, no network, nothing to configure.
// ---------------------------------------------------------------------------

/** The most the assistant will set up in one go: a billion naira, in kobo. */
const MOST_KOBO = 100_000_000_000;

/**
 * Naira written as a plain decimal ("2500", "2500.5", "0.75"), as whole kobo.
 * Worked out on the digits and never by multiplying a fraction: in floating
 * point 1.005 × 100 is 100.49999…, which rounds to the wrong kobo. `scale`
 * is the "k" or "m" that was said. Half a kobo rounds up. `null` for anything
 * that is not a plain decimal, or is more than a number can hold exactly.
 */
export function koboFromDecimal(text: string, scale = 1): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? '';
  // digits × scale × 100 ÷ 10^(digits after the point), all in whole numbers.
  const numerator = BigInt(match[1]! + fraction) * BigInt(scale) * 100n;
  const divisor = 10n ** BigInt(fraction.length);
  const inKobo = (numerator + divisor / 2n) / divisor;
  return inKobo <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(inKobo) : null;
}

/**
 * "5000", "5,000", "₦5000", "5k", "2.5k", "1.5m", "5000 naira", in naira as
 * a person says it. `null` when it is not an amount.
 *
 * The naira it returns is whole kobo divided by a hundred and nothing else,
 * so `toMinor` gets the same kobo back out of it; no sum is ever done on it.
 */
export function parseSpokenAmount(text: string): number | null {
  const match = /^(?:₦|ngn|n)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:naira|ngn)?$/i.exec(text.trim());
  if (!match) return null;
  const unit = match[2]?.toLowerCase();
  const scale = unit === 'k' || unit === 'thousand' ? 1_000 : unit === 'm' || unit === 'million' ? 1_000_000 : 1;
  const inKobo = koboFromDecimal(match[1]!.replace(/,/g, ''), scale);
  return inKobo !== null && inKobo > 0 && inKobo <= MOST_KOBO ? inKobo / 100 : null;
}

const AMOUNT = String.raw`(?:₦|ngn\s*|n)?\d[\d,]*(?:\.\d+)?\s*(?:k|thousand|m|million)?(?:\s*naira)?`;

const SCREEN_WORDS: [RegExp, AssistantScreen][] = [
  [/^(?:home|the start|my account|dashboard)$/, 'home'],
  [/^(?:send|send money|a payment|pay someone)$/, 'send'],
  [/^(?:pay|payments|transfer|transfers)$/, 'pay'],
  [/^(?:receive|my link|my qr|my username|get paid)$/, 'receive'],
  [/^(?:add money|top up|fund|deposit)$/, 'add-money'],
  [/^(?:activity|history|transactions|my payments|payments history)$/, 'activity'],
  [/^(?:savings|my savings|save|grow)$/, 'savings'],
  [/^(?:stocks|shares|investments)$/, 'stocks'],
  [/^(?:bills|bill|airtime|data|electricity|light)$/, 'bills'],
  [/^(?:business|my business)$/, 'business'],
  [/^(?:invoice|an invoice|new invoice)$/, 'invoice'],
  [/^(?:people|beneficiaries|my beneficiaries|saved people)$/, 'people'],
  [/^(?:allowance|an allowance|new allowance|allowances)$/, 'new-allowance'],
  [/^(?:assistant|the assistant|assistant settings)$/, 'assistant'],
  [/^(?:me|profile|my profile|settings)$/, 'me'],
];

function screenFor(words: string): AssistantScreen | null {
  const cleaned = words.replace(/^(?:my|the)\s+/, '').replace(/\s+(?:screen|page|tab)$/, '');
  for (const [pattern, screen] of SCREEN_WORDS) if (pattern.test(cleaned) || pattern.test(words)) return screen;
  return null;
}

type BillKind = 'electricity' | 'airtime-data' | 'cable-tv' | 'internet';

/** What people call each kind of bill. "Light" is electricity, "DSTV" is the cable bill. */
const BILL_WORDS: [RegExp, BillKind][] = [
  [/^(?:electricity|light|nepa|power|prepaid meter|meter|light bill|electricity bill|phcn)$/, 'electricity'],
  [/^(?:airtime|data|recharge card|credit|call credit|mobile data|airtime and data)$/, 'airtime-data'],
  [/^(?:dstv|gotv|startimes|cable|cable tv|tv|tv subscription|dstv subscription|gotv subscription)$/, 'cable-tv'],
  [/^(?:internet|wifi|wi-fi|spectranet|smile|broadband)$/, 'internet'],
];

/** Words that make a "recipient" a bill: no one saved as "my light bill" is being paid. */
const BILL_NAMED = /\bbills?\b/i;

function billKind(words: string): BillKind | null {
  const cleaned = words
    .toLowerCase()
    .replace(/[\s,;:]+$/, '')
    .replace(/^(?:for\s+)?(?:my|the)\s+/, '')
    .replace(/\s+bills?$/, '')
    .trim();
  for (const [pattern, kind] of BILL_WORDS) if (pattern.test(cleaned)) return kind;
  return null;
}

/**
 * "pay my light bill", "pay dstv 5k", "buy 1000 airtime", "pay 10k for light".
 * The kind of bill, and the amount when one was said.
 */
function readBillRequest(original: string): AssistantAction | null {
  const kindFirst = new RegExp(String.raw`^(?:pay|buy|recharge|top up|renew)\s+(?:for\s+)?(.+?)(?:\s+(?:with\s+|for\s+)?(${AMOUNT}))?$`, 'i').exec(original);
  const amountFirst = new RegExp(String.raw`^(?:pay|buy|recharge|top up)\s+(${AMOUNT})\s+(?:of\s+|worth of\s+|for\s+|on\s+)?(.+)$`, 'i').exec(original);
  const read = amountFirst
    ? { kind: billKind(amountFirst[2]!), amount: amountFirst[1] }
    : kindFirst
      ? { kind: billKind(kindFirst[1]!), amount: kindFirst[2] }
      : null;
  if (!read?.kind) return null;
  if (read.amount === undefined) return { do: 'bill', kind: read.kind };
  const amount = parseSpokenAmount(read.amount);
  return amount ? { do: 'bill', kind: read.kind, amount } : null;
}

/**
 * Reads the sentences that can only mean one thing: "send 5,000 to Ada for
 * rent", "open receive", "what's my balance". `null` for anything else, which
 * is the cue to ask a language model, or, with none to ask, to say so.
 *
 * It is deliberately narrow. A grammar that guesses turns "5k" into five
 * naira; this one either knows or stays quiet.
 */
export function readPlainRequest(input: string): AssistantReply | null {
  // The assistant's name and the greeting that wakes it are not part of the request.
  const text = withoutName(input)
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
  // Just the name, "hey Ayo": a greeting, and answered as one.
  if (!text) return input.trim() ? { say: readSmallTalk('hello')!, actions: [] } : null;
  const lower = text.toLowerCase().replace(/^(?:please|hey entole|entole|ok|okay)[, ]+/, '');
  const offset = text.length - lower.length;
  const original = text.slice(offset);

  // Bills come before people: "pay dstv 5k" is a bill, not someone called DSTV.
  const bill = readBillRequest(original);
  if (bill) return { actions: [bill] };

  // "send 5000 to ada for rent" / "pay ada 5k for rent"
  const amountFirst = new RegExp(String.raw`^(?:pay|send|transfer|give)\s+(${AMOUNT})\s+to\s+(.+?)(?:\s+for\s+(.+))?$`, 'i').exec(original);
  const nameFirst = new RegExp(String.raw`^(?:pay|send|give)\s+(.+?)\s+(${AMOUNT})(?:\s+for\s+(.+))?$`, 'i').exec(original);
  const paid = amountFirst
    ? { amount: amountFirst[1]!, to: amountFirst[2]!, note: amountFirst[3] }
    : nameFirst
      ? { amount: nameFirst[2]!, to: nameFirst[1]!, note: nameFirst[3] }
      : null;
  if (paid) {
    const amount = parseSpokenAmount(paid.amount);
    const to = paid.to.trim();
    // A "person" named after a bill is a bill this grammar could not read: the model's to read, never a payment.
    if (amount && to && !/\s(?:and|then)\s/i.test(to) && !BILL_NAMED.test(to)) {
      return { actions: [{ do: 'pay', to, amount, ...(paid.note ? { note: paid.note.trim().slice(0, 80) } : {}) }] };
    }
    return null;
  }
  const payNoAmount = /^(?:pay|send money to|send to)\s+(.+)$/i.exec(original);
  if (payNoAmount && !/\d/.test(payNoAmount[1]!) && !/\s(?:and|then)\s/i.test(payNoAmount[1]!)) {
    return { actions: [{ do: 'pay', to: payNoAmount[1]!.trim() }] };
  }

  // "send money", "I want to send money": no one named yet, so Send opens on the people to pick from.
  if (/^(?:(?:i (?:want|wanna|need|would like) to|i'd like to|let me|can i|let's|lets|help me)\s+)?(?:send(?: some)? money|make a payment|pay someone|pay somebody|send a payment)$/.test(lower)) {
    return { actions: [{ do: 'open', screen: 'send' }] };
  }
  if (/^(?:take me|go|carry me|bring me)(?: back)? home$/.test(lower)) return { actions: [{ do: 'open', screen: 'home' }] };

  // "show my balance" is a fact asked for, not a screen named.
  if (/^(?:show|check|tell|read)(?: me)?(?: out)? (?:my |the )?balance$|^how much (?:money )?do i have$/.test(lower)) {
    return { actions: [{ do: 'tell', about: 'balance' }] };
  }

  // Asked of Ayo, not screens: these come before "show …" is read as a screen.
  if (/^(?:(?:give me |do |start )?(?:my |the |a )?(?:monthly )?check[- ]?in)$/.test(lower)) return { actions: [{ do: 'checkin' }] };
  if (/^(?:what(?:'s| is) new|anything new|what(?:'s| is) new with my money)$/.test(lower)) return { actions: [{ do: 'tell', about: 'whats-new' }] };
  if (/^(?:(?:show |show me |what are )?my goals)$/.test(lower)) return { actions: [{ do: 'tell', about: 'goals' }] };
  if (/^(?:(?:show |show me |what are )?my reminders)$/.test(lower)) return { actions: [{ do: 'tell', about: 'reminders' }] };
  const opened = /^(?:open|go to|show me|show|take me to|bring up)\s+(.+)$/.exec(lower);
  if (opened) {
    const screen = screenFor(opened[1]!);
    return screen ? { actions: [{ do: 'open', screen }] } : null;
  }

  if (/^(?:what(?:'s| is) my balance|my balance|balance|how much (?:do i have|have i got|is in my account))$/.test(lower)) {
    return { actions: [{ do: 'tell', about: 'balance' }] };
  }
  if (/^(?:what(?:'s| is) my username|my username)$/.test(lower)) return { actions: [{ do: 'tell', about: 'username' }] };
  if (/^(?:what (?:did i|have i) (?:spen[dt]|sen[dt]|receive[d]?)|(?:my )?(?:last|recent|latest) (?:payments?|transactions?)|did (?:anyone|someone) (?:pay|send) me.*)$/.test(lower)) {
    return { actions: [{ do: 'tell', about: 'recent' }] };
  }
  if (/^(?:how much (?:is|do i have) in (?:my )?savings|my savings balance)$/.test(lower)) {
    return { actions: [{ do: 'tell', about: 'savings' }] };
  }
  if (/^(?:what can (?:you|the assistant) (?:spend|pay)|my allowances|how much is left(?: in my allowances?)?)$/.test(lower)) {
    return { actions: [{ do: 'tell', about: 'allowances' }] };
  }

  const requested = new RegExp(String.raw`^(?:request|ask for|i want to receive|receive)\s+(${AMOUNT})$`, 'i').exec(original);
  if (requested) {
    const amount = parseSpokenAmount(requested[1]!);
    return amount ? { actions: [{ do: 'request', amount }] } : null;
  }

  const saved = new RegExp(String.raw`^(?:save|put)\s+(${AMOUNT})(?:\s+(?:in|into|to)\s+(?:my\s+)?savings)?$`, 'i').exec(original);
  if (saved) {
    const amount = parseSpokenAmount(saved[1]!);
    return amount ? { actions: [{ do: 'save', amount }] } : null;
  }
  const taken = new RegExp(String.raw`^(?:take out|withdraw|take)\s+(${AMOUNT})(?:\s+(?:out of|from|out)\s*(?:my\s+)?(?:savings)?)?$`, 'i').exec(original);
  if (taken) {
    const amount = parseSpokenAmount(taken[1]!);
    return amount ? { actions: [{ do: 'take-out', amount }] } : null;
  }

  if (/^(?:pause|stop|hold)(?: the)? assistant$/.test(lower)) return { actions: [{ do: 'pause' }] };
  if (/^(?:resume|unpause|continue|start)(?: the)? assistant$/.test(lower)) return { actions: [{ do: 'resume' }] };

  const chat = readSmallTalk(lower);
  return chat ? { say: chat, actions: [] } : null;
}

/**
 * The few things a person says to someone they are talking to that are not a
 * request: hello, thanks, who are you, what can you do. Answered here, with no
 * model and no network, so the assistant is never silent to a greeting even
 * when the model is out of reach. Anything longer or odder goes to the model.
 */
export function readSmallTalk(lower: string): string | null {
  const said = lower.replace(/[,.!?]/g, '').replace(/\s+/g, ' ').trim();
  if (/^(?:hi|hello|hey|hiya|yo|good (?:morning|afternoon|evening)|how far|how you dey|wetin dey happen)(?: there| ayo)?$/.test(said)) {
    return 'Hello. What do you need?';
  }
  if (/^(?:how are you|how are you doing|how is it going|how('s| is) your day|you good|are you there|you dey)$/.test(said)) {
    return 'I’m good, thank you. What do you need?';
  }
  if (/^(?:thanks|thank you|thank you so much|thanks a lot|nice one|well done|good job|great|cool|perfect|okay thanks|ok thanks|i dey appreciate)$/.test(said)) {
    return 'You’re welcome.';
  }
  if (/^(?:who are you|what is your name|what are you called|what('s| is) your name|introduce yourself)$/.test(said)) {
    return 'I’m Ayo. I keep an eye on your money with you, and get things ready for you to confirm.';
  }
  if (/^(?:help|help me|what can you do|what do you do|what can i say|what can i ask you|how do you work|how does this work)$/.test(said)) {
    return 'I can tell you where your money stands, keep your goals and reminders, and get payments ready for you to confirm. Try saying: what\'s new, or send five thousand to Ada.';
  }
  if (/^(?:bye|goodbye|good night|see you|see you later|that is all|that's all|nothing|never mind|nevermind|cancel|stop|stop listening)$/.test(said)) {
    return 'Alright. I’m here if you need me.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Saying what the app knows.
// ---------------------------------------------------------------------------

/** The account as the app holds it: where every spoken figure comes from. */
export type AssistantFacts = {
  balanceMinor: number;
  activity: Activity[];
  allowances: AllowanceView[];
  /** `null` when there is no savings position to speak of. */
  savingsMinor: number | null;
  username: string | null;
  contactName: (contactId: string) => string | undefined;
  /** The money picture from the person's own statements and activity; null until one is read. */
  picture?: MoneyPicture | null;
  /** The lines the picture was built from, for the check-in and the nudges. */
  lines?: readonly StatementLine[] | null;
  /** Currency pockets, when they have been read. */
  pockets?: readonly { currency: PocketCurrency; cents: number; words: string }[] | null;
  /** What Ayo remembers (`ayo-memory.ts`), as kept. Undefined when it was not read; null when it could not be. */
  memory?: readonly MemoryEntry[] | null;
  invoices?: readonly Invoice[];
  /** The person's own name, as they gave it. Only the first word is ever said. */
  displayName?: string | null;
  /** Which turn of the conversation this is: picks between ways of saying the same thing. */
  turn?: number;
};

const NO_PICTURE = 'I can work that out once you read a bank statement in Plan. It stays private to you.';
const naira = (minor: number) => formatNaira(kobo(minor));

/** How the person likes to be answered, from what Ayo remembers. */
function styleOf(facts: AssistantFacts): ReplyStyle | null {
  return facts.memory ? readMemory(facts.memory).replyStyle : null;
}

/** The first sentence alone for someone who asked for short answers; all of it otherwise. */
function said(facts: AssistantFacts, ...sentences: (string | null | false | undefined)[]): string {
  const kept = sentences.filter((sentence): sentence is string => Boolean(sentence));
  return (styleOf(facts) === 'short' ? kept.slice(0, 1) : kept).join(' ');
}

/** Who usually pays, when one source pays monthly: "Brightloop". */
function payer(picture: MoneyPicture): string | null {
  const source = picture.income.sources.find((each) => each.monthly);
  return source?.name || null;
}

/** "until 25 November, when Brightloop usually pays", or the month's end without a payday. */
function untilWords(picture: MoneyPicture): string {
  if (!picture.safeToSpend?.untilIncome || !picture.income.nextExpected) return 'until the end of the month';
  const who = payer(picture);
  return `until ${dayWords(picture.income.nextExpected)}, when ${who ? `${who} usually pays` : 'money usually comes in'}`;
}

/** The money picture, in a sentence or two. Every figure is the person's own. */
function tellPicture(about: 'safe-to-spend' | 'leaks' | 'subscriptions' | 'picture' | 'tax', facts: AssistantFacts): string {
  const picture = facts.picture;
  const turn = facts.turn ?? 0;
  if (!picture) return NO_PICTURE;
  if (about === 'safe-to-spend') {
    const safe = picture.safeToSpend;
    if (!safe) return 'I need at least four weeks of statements before I can say what is safe to spend.';
    const day = naira(safe.todayMinor);
    const until = untilWords(picture);
    return said(
      facts,
      pick([`About ${day} a day is safe to spend ${until}.`, `You can spend about ${day} a day ${until}.`, `Keep it to about ${day} a day ${until} and you're fine.`], turn),
      'That is after your bills, savings and tax are set aside.',
    );
  }
  if (about === 'leaks') {
    const leaks = picture.leaks;
    if (!leaks.count) return 'No small payments stand out in your last month. Nice and tidy.';
    const share = leaks.shareOfIncomeBps !== null ? `, about ${Math.round(leaks.shareOfIncomeBps / 100)}% of a month's income` : '';
    const top = leaks.top[0] ? pick([`Most of it went to ${leaks.top[0].name}.`, `${leaks.top[0].name} took the most.`], turn) : null;
    return said(
      facts,
      pick(
        [
          `In the last ${leaks.days} days, ${leaks.count} small payments added up to ${naira(leaks.totalMinor)}${share}.`,
          `${leaks.count} small payments in ${leaks.days} days came to ${naira(leaks.totalMinor)}${share}.`,
        ],
        turn,
      ),
      top,
    );
  }
  if (about === 'subscriptions') {
    const subs = picture.subscriptions;
    if (!subs.count) return 'I do not see any monthly subscriptions in your statements.';
    if (subs.count === 1) return `You pay for one subscription, ${subs.items[0]!.name}, about ${naira(subs.monthlyMinor)} a month.`;
    const names = subs.items.slice(0, 3).map((item) => item.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    return said(facts, `You pay for ${subs.count} subscriptions, ${naira(subs.monthlyMinor)} a month together.`, `The biggest are ${list}.`);
  }
  if (about === 'tax') {
    if (!picture.tax) return 'I need a few weeks of income in your statements to estimate tax.';
    return said(
      facts,
      `On this income, tax comes to about ${naira(picture.tax.monthlyTaxMinor)} a month under the 2026 rules, around ${Math.round(picture.tax.effectiveBps / 100)}% of what you earn.`,
      'It is an estimate to plan with, not a filing.',
    );
  }
  const net = picture.netMonthlyMinor;
  const kept = net >= 0 ? `so you keep about ${naira(net)}` : `so about ${naira(-net)} more goes out than comes in`;
  const runway = picture.runwayMonths !== null ? `At that pace, what you have lasts ${monthsWords(picture.runwayMonths)}.` : null;
  return said(facts, `In a usual month about ${naira(picture.income.monthlyMinor)} comes in and ${naira(picture.out.monthlyMinor)} goes out, ${kept}.`, runway);
}

/** "Can I afford it?", answered from the picture. */
export function tellAfford(amountMinor: number, picture: MoneyPicture | null | undefined, turn = 0): string {
  if (!picture) return NO_PICTURE;
  const check = affordCheck(picture, amountMinor);
  if (!check) return 'I need at least four weeks of statements to answer that.';
  const amount = formatNaira(kobo(amountMinor));
  const back = check.daysToEarnBack !== null ? ` You'd earn it back in about ${check.daysToEarnBack} days.` : '';
  if (check.verdict === 'not-now') {
    const wait = picture.income.nextExpected ? ` If it can wait until ${dayWords(picture.income.nextExpected)}, it gets much easier.` : '';
    return `Not right now. ${amount} would dip into ${formatNaira(kobo(check.shortByMinor))} you need for bills and savings before money comes in.${wait}`;
  }
  const runway = check.runwayAfter !== null ? monthsWords(check.runwayAfter) : null;
  if (check.verdict === 'tight') {
    return `You can, but it's tight.${runway ? ` After it, your money lasts ${runway}.` : ''}${back}`;
  }
  return `${pick(['Yes, you can.', 'Yes, that is fine.'], turn)}${runway ? ` After ${amount} your money still lasts ${runway}.` : ''}${back}`;
}

/** Goals, each with how far along it is when savings can say. */
function tellGoals(facts: AssistantFacts, today: string): string {
  const goals = readMemory(facts.memory ?? []).goals;
  if (!goals.length) return 'You have not set a goal yet. Tell me what you are saving for and by when, and I will keep track.';
  return goals
    .slice(0, 3)
    .map((goal) => {
      const by = goal.by ? `, by ${dayWords(goal.by)}` : '';
      if (facts.savingsMinor === null) return `${goal.name}: ${naira(goal.amountMinor)}${by}.`;
      const progress = goalProgress(goal, facts.savingsMinor, today);
      if (progress.reached) return `${goal.name}: all ${naira(goal.amountMinor)} put aside. Done.`;
      return `${goal.name}: ${naira(progress.savedMinor)} of ${naira(goal.amountMinor)}${by}.`;
    })
    .join(' ');
}

function tellReminders(facts: AssistantFacts, today: string): string {
  const open = readMemory(facts.memory ?? [])
    .reminders.filter((reminder) => !reminder.done)
    .sort((a, b) => a.due.localeCompare(b.due));
  if (!open.length) return 'No reminders right now.';
  const each = open.slice(0, 3).map((reminder) => `${reminder.what}, ${whenWords(reminder.due, today)}`);
  const more = open.length > 3 ? ` And ${open.length - 3} more.` : '';
  return `${open.length === 1 ? 'One reminder' : `${open.length} reminders`}: ${each.join('; ')}.${more}`;
}

/** The nudges for today, from everything the facts hold. */
export function nudgesFrom(facts: AssistantFacts, now = new Date()): Nudge[] {
  return buildNudges({
    today: lagosToday(now),
    picture: facts.picture ?? null,
    lines: facts.lines ?? null,
    balanceMinor: facts.balanceMinor,
    savingsMinor: facts.savingsMinor,
    invoices: facts.invoices ?? [],
    memory: facts.memory ? readMemory(facts.memory) : EMPTY_MEMORY,
  });
}

/** A fact, in a sentence a person would say. Every figure is the app's own. */
export function tellAbout(about: Extract<AssistantAction, { do: 'tell' }>['about'], facts: AssistantFacts, now = new Date()): string {
  const turn = facts.turn ?? 0;
  const today = lagosToday(now);
  if (about === 'safe-to-spend' || about === 'leaks' || about === 'subscriptions' || about === 'picture' || about === 'tax') {
    return tellPicture(about, facts);
  }
  if (about === 'goals') return tellGoals(facts, today);
  if (about === 'reminders') return tellReminders(facts, today);
  if (about === 'whats-new') {
    const nudges = nudgesFrom(facts, now);
    if (!nudges.length) return pick(['Nothing needs you right now. You are all good.', 'All quiet. Nothing needs you today.'], turn);
    const name = firstNameOf(facts.displayName);
    const lead = nudges.length > 1 ? `${name ? `${name}, ` : ''}${nudges.length === 2 ? 'Two' : 'Three'} things.` : null;
    // The offer, when there is one, is the first nudge's, asked last so a yes answers it.
    const [first, ...rest] = nudges;
    return said(facts, lead, ...rest.map((nudge) => nudge.text), nudgeLine(first!));
  }
  if (about === 'pockets') {
    const held = (facts.pockets ?? []).filter((pocket) => pocket.cents > 0);
    if (!facts.pockets) return 'I could not read your currency pockets just now.';
    if (!held.length) return 'Your currency pockets are empty. Say add dollars and I will open it.';
    const amounts = held.map((pocket) => formatPocketAmount(pocket.cents, pocket.currency));
    const list = amounts.length > 1 ? `${amounts.slice(0, -1).join(', ')} and ${amounts.at(-1)}` : amounts[0];
    return pick([`You hold ${list}.`, `In your pockets: ${list}.`], turn);
  }
  if (about === 'balance') {
    const amount = formatNaira(kobo(facts.balanceMinor));
    const first = pick([`You have ${amount}.`, `You've got ${amount} in your account.`, `${amount}, right now.`], turn);
    const safe = facts.picture?.safeToSpend;
    const relate = safe && facts.picture ? `About ${naira(safe.todayMinor)} a day of it is safe to spend ${untilWords(facts.picture)}.` : null;
    return said(facts, first, relate);
  }
  if (about === 'username') return facts.username ? `Your username is @${facts.username}. People can pay you with it.` : 'You have not chosen a username yet.';
  if (about === 'savings') {
    if (!facts.savingsMinor || facts.savingsMinor <= 0) return 'There is nothing in savings yet. Say save five thousand and I will open it.';
    const goal = readMemory(facts.memory ?? []).goals.find((each) => each.by) ?? null;
    const progress = goal ? goalProgress(goal, facts.savingsMinor, today) : null;
    const relate = goal && progress && !progress.reached ? `${naira(progress.savedMinor)} of that is towards ${goal.name}.` : null;
    return said(facts, pick([`You have ${naira(facts.savingsMinor)} in savings.`, `${naira(facts.savingsMinor)} is put aside in savings.`], turn), relate);
  }
  if (about === 'allowances') {
    if (facts.allowances.length === 0) return 'I have no allowance yet, so I cannot pay anyone on my own. Everything waits for you.';
    return facts.allowances
      .slice(0, 3)
      .map((allowance) => {
        const who = facts.contactName(allowance.recipientId) ?? allowance.name;
        const left = `${formatNaira(allowance.remainingMinor)} left of ${formatNaira(allowance.limitMinor)}`;
        return `${who}: ${left}${allowance.paused ? ', paused' : ''}.`;
      })
      .join(' ');
  }
  const recent = facts.activity.slice(0, 3);
  if (recent.length === 0) return 'Nothing has moved in or out yet.';
  return recent
    .map((entry) => {
      const who = facts.contactName(entry.contactId) ?? 'someone';
      const amount = formatNaira(kobo(entry.amountMinor));
      const when = relativeMoment(entry.at, now);
      if (entry.direction === 'in') return `${who} sent you ${amount}, ${when}.`;
      return entry.initiatedBy === 'assistant'
        ? `I paid ${who} ${amount} from their allowance, ${when}.`
        : `You sent ${amount} to ${who}, ${when}.`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Working out who "mum" is, and what paying them means right now.
// ---------------------------------------------------------------------------

export type Payee =
  | { kind: 'saved'; contact: Contact }
  | { kind: 'several'; names: string[] }
  | { kind: 'look-up' }
  | { kind: 'nobody' };

/** Who a spoken name is among the people saved, before the directory is asked. */
export function findSavedPayee(spoken: string, contacts: readonly Contact[]): Payee {
  const name = spoken.trim().replace(/^my\s+/i, '').toLowerCase();
  if (!name) return { kind: 'nobody' };
  const calledThat = contacts.filter((contact) => contact.nickname?.toLowerCase() === name);
  if (calledThat.length === 1) return { kind: 'saved', contact: calledThat[0]! };
  const exact = contacts.filter((contact) => contact.name.toLowerCase() === name);
  if (exact.length === 1) return { kind: 'saved', contact: exact[0]! };
  const close = (exact.length > 1 ? exact : contacts).filter((contact) => {
    const full = contact.name.toLowerCase();
    return full === name || full.split(' ')[0] === name || full.startsWith(`${name} `);
  });
  if (close.length === 1) return { kind: 'saved', contact: close[0]! };
  if (close.length > 1) return { kind: 'several', names: close.map((contact) => contact.name).slice(0, 4) };
  // Not said the way it is saved: a recogniser writes "a day zay" for Adaeze. Match by sound before looking elsewhere.
  const alike = bestNameMatch(name, contacts);
  if (alike && 'match' in alike) return { kind: 'saved', contact: alike.match };
  if (alike) return { kind: 'several', names: alike.several.map((contact) => contact.name).slice(0, 4) };
  return readRecipient(spoken) ? { kind: 'look-up' } : { kind: 'nobody' };
}

/**
 * Where a fact lives. Asking for one takes the person there, so "what's my
 * balance" lands on Home with the figure in front of them as well as in their
 * ear.
 */
const FACT_SCREEN: Record<Extract<AssistantAction, { do: 'tell' }>['about'], AssistantScreen | null> = {
  balance: 'home',
  recent: 'activity',
  allowances: 'home',
  savings: 'savings',
  username: 'receive',
  'safe-to-spend': 'plan',
  leaks: 'plan',
  subscriptions: 'plan',
  picture: 'plan',
  tax: 'plan',
  pockets: 'money',
  // Said where the person is: the conversation goes on, and a yes can follow.
  goals: null,
  reminders: null,
  'whats-new': null,
};

/** What the app does next. Each app turns these into its own navigation. */
export type AssistantStep =
  | { kind: 'say'; text: string }
  | { kind: 'open'; screen: AssistantScreen }
  /** Open Send with the person chosen and whatever is known filled in. The person confirms. */
  | { kind: 'send'; contactId: string; amountMinor?: number; note?: string }
  /** A payment inside an allowance: it waits out its undo window, then the contract decides. */
  | { kind: 'propose'; proposal: Proposal }
  | { kind: 'request'; amountMinor?: number }
  | { kind: 'savings'; mode: 'deposit' | 'withdraw'; amountMinor?: number }
  | { kind: 'bill'; category?: string; amountMinor?: number }
  | { kind: 'pause'; paused: boolean }
  /** Money's Change currency sheet, filled in. It quotes first; the person confirms. Amount in the "from" pocket's cents. */
  | { kind: 'swap'; from: PocketId; to: PocketId; amountCents?: number }
  | { kind: 'add-to-pocket'; pocket?: PocketId }
  /** What Ayo remembers, as it now stands: the app keeps this list (`backend.memory.write`). */
  | { kind: 'remember'; entries: MemoryEntry[] }
  /**
   * Something offered, not done: the app holds it, and a yes on the next turn
   * carries it out (`answerOffer`). A no puts the nudge away.
   */
  | { kind: 'offer'; step: AssistantStep; nudgeId: string | null };

/** A question Ayo asked and is waiting on: "Want me to put ₦50,000 aside?" */
export type PendingOffer = { step: AssistantStep; nudgeId: string | null };

export type AssistantAccount = {
  contacts: readonly Contact[];
  allowances: readonly AllowanceView[];
  /** The assistant has been turned on to spend: it holds its own key and can run an allowance. */
  canSpend: boolean;
  paused: boolean;
};

/**
 * An amount as it was said or as the reader wrote it, in naira, as whole
 * kobo. Read from the number's own digits (see `koboFromDecimal`). An amount
 * too small to be a kobo, or one that is not a plain figure, is no amount.
 */
function toMinor(amount: number | undefined): number | undefined {
  if (amount === undefined) return undefined;
  const inKobo = koboFromDecimal(String(amount));
  return inKobo !== null && inKobo > 0 ? inKobo : undefined;
}

/**
 * Turns "pay Ada 5,000 for rent" into what the app should do about it.
 *
 * If the assistant may spend, and there is an allowance for this person with
 * enough left in it, the payment is the assistant's to make: a proposal, with
 * its undo window. Otherwise the assistant gets everything ready and steps
 * back: Send opens with the person and the amount filled in, and the person
 * confirms it themselves.
 */
export async function planPayment(
  action: Extract<AssistantAction, { do: 'pay' }>,
  account: AssistantAccount,
  deps: {
    directory: HandleDirectory;
    resolveContactId?: (address: `0x${string}`) => string | undefined;
    now?: () => number;
    /** The person is talking, not typing: the review opens on its own and the assistant reads it out. */
    byVoice?: boolean;
  },
): Promise<AssistantStep[]> {
  const amountMinor = toMinor(action.amount);
  const amountWords = amountMinor !== undefined ? formatNaira(kobo(amountMinor)) : null;

  let contactId: string | null = null;
  let name = action.to;
  const payee = findSavedPayee(action.to, account.contacts);
  if (payee.kind === 'saved') {
    contactId = payee.contact.id;
    name = payee.contact.name;
  } else if (payee.kind === 'several') {
    return [{ kind: 'say', text: `You have saved ${payee.names.join(' and ')}. Which one?` }];
  } else if (payee.kind === 'look-up') {
    const sought = readRecipient(action.to)!;
    const found = await findRecipient(deps.directory, sought).catch(() => null);
    if (!found) return [{ kind: 'say', text: `I couldn't find ${action.to} on Entole. Check the username or number.` }];
    contactId = deps.resolveContactId?.(found.address) ?? oneOffId(found.code, found.payee);
    name = found.payee ?? action.to;
  }
  if (!contactId) {
    return [{ kind: 'say', text: `I don't know who ${action.to} is. Say their username or their phone number.` }];
  }

  const allowance = account.allowances.find((entry) => entry.recipientId === contactId && !entry.paused);
  if (account.canSpend && !account.paused && allowance && amountMinor !== undefined && amountMinor <= allowance.remainingMinor) {
    return [
      {
        kind: 'propose',
        proposal: {
          id: `ask-${(deps.now ?? Date.now)().toString(36)}`,
          allowanceId: allowance.id,
          contactId,
          amountMinor,
          note: action.note || 'Asked in the app',
          undoSeconds: ASK_UNDO_SECONDS,
        },
      },
      { kind: 'say', text: `Sending ${amountWords} to ${name} from their allowance. You can stop it for the next ${ASK_UNDO_SECONDS} seconds.` },
    ];
  }

  return [
    { kind: 'send', contactId, ...(amountMinor !== undefined ? { amountMinor } : {}), ...(action.note ? { note: action.note } : {}) },
    {
      kind: 'say',
      text: amountWords
        ? deps.byVoice
          ? `${name}, ${amountWords}. Let me pull up the details.`
          : `${name}, ${amountWords}. Check it, then confirm it yourself.`
        : deps.byVoice
          ? `Here is ${name}. How much would you like to send?`
          : `Here is ${name}. Enter the amount, then confirm it yourself.`,
    },
  ];
}

const pocketWords = (id: PocketId) => POCKETS.find((pocket) => pocket.id === id)!.words.toLowerCase();
const pocketCurrency = (id: PocketId) => POCKETS.find((pocket) => pocket.id === id)!.currency;

/** What is said for a step when nothing truer was said: someone talking is not looking. */
export function stepWords(step: AssistantStep, turn = 0): string | null {
  if (step.kind === 'open') return pick([`Opening ${SCREEN_NAMES[step.screen]}.`, `Here's ${SCREEN_NAMES[step.screen]}.`], turn);
  if (step.kind === 'request') {
    return step.amountMinor !== undefined ? `Here is your link, asking for ${formatNaira(kobo(step.amountMinor))}.` : 'Here is how you get paid.';
  }
  if (step.kind === 'savings') {
    const filled = step.amountMinor !== undefined ? `, with ${formatNaira(kobo(step.amountMinor))} filled in` : '';
    return step.mode === 'deposit' ? `Here is savings${filled}. You confirm what goes in.` : `Here is savings${filled}. You confirm what comes out.`;
  }
  if (step.kind === 'bill') {
    if (!step.category) return 'Here are your bills.';
    return step.amountMinor !== undefined
      ? `Here is that bill, for ${formatNaira(kobo(step.amountMinor))}. Add the account number, then confirm it yourself.`
      : 'Here is that bill. Add the account number and the amount, then confirm it yourself.';
  }
  if (step.kind === 'swap') {
    const amount = step.amountCents !== undefined ? `, for ${formatPocketAmount(step.amountCents, pocketCurrency(step.from))}` : '';
    return `Here is the change from ${pocketWords(step.from)} to ${pocketWords(step.to)}${amount}. You will see the quote first, then you confirm it.`;
  }
  if (step.kind === 'add-to-pocket') {
    return step.pocket
      ? `Here is Add to a pocket, for ${pocketWords(step.pocket)}. Pick where it is coming from and you get a code to pay in.`
      : 'Here is Add to a pocket. Pick the currency and where it is coming from.';
  }
  return null;
}

/** A yes or a no to something Ayo just offered, in English or Pidgin. Null for anything else. */
export function readAnswer(text: string): 'yes' | 'no' | null {
  const said = withoutName(text).toLowerCase().replace(/[,.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:yes|yeah|yep|yup|sure|ok|okay|alright|go ahead|do it|please do|yes please|yes do it|ok do it|okay do it|sure go ahead|abeg do am|do am|oya|oya do am|make we do am|sharp|why not|let's do it|lets do it|go on)$/.test(said)) return 'yes';
  if (/^(?:no|nope|nah|not now|later|maybe later|no thanks|no thank you|leave it|skip|skip it|don't|do not|abeg no|no be now|leave am|no o|not today)$/.test(said)) return 'no';
  return null;
}

/** What a yes or a no to an offer comes to. A yes only opens or gets ready, like anything else; a no keeps the nudge away. */
export function answerOffer(
  answer: 'yes' | 'no',
  offer: PendingOffer,
  context: { memory?: readonly MemoryEntry[] | null; now?: Date; turn?: number } = {},
): AssistantStep[] {
  const turn = context.turn ?? 0;
  if (answer === 'yes') return [offer.step, { kind: 'say', text: stepWords(offer.step, turn) ?? 'Here it is.' }];
  const steps: AssistantStep[] = [];
  if (offer.nudgeId && context.memory) {
    const outcome = changeMemory(context.memory, { kind: 'dismiss', id: offer.nudgeId }, {
      now: context.now ?? new Date(),
      today: lagosToday(context.now ?? new Date()),
      savingsMinor: null,
    });
    if (outcome.ok) steps.push({ kind: 'remember', entries: outcome.entries });
  }
  steps.push({ kind: 'say', text: pick(['Okay, I will leave it.', 'No problem. I will not bring it up again.', 'Alright, another time.'], turn) });
  return steps;
}

const ordinal = (day: number) => `${day}${day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'}`;

type MemoryAction = Extract<AssistantAction, { do: 'goal' | 'prefer' | 'remind' | 'forget' }>;

/** One memory action, kept, and what Ayo says about it. */
function planMemory(action: MemoryAction, memory: readonly MemoryEntry[], facts: AssistantFacts, now: Date): { entries: MemoryEntry[] | null; text: string } {
  const today = lagosToday(now);
  const context = { now, today, savingsMinor: facts.savingsMinor };
  if (action.do === 'goal') {
    const amountMinor = toMinor(action.amount);
    if (amountMinor === undefined) return { entries: null, text: 'How much is the goal?' };
    const outcome = changeMemory(memory, { kind: 'goal', name: action.name, amountMinor, by: action.by }, context);
    if (!outcome.ok) {
      if (outcome.why === 'bad-when') return { entries: null, text: 'By when? Say a month or a date, like by March.' };
      if (outcome.why === 'too-many') return { entries: null, text: 'You have a lot of goals already. Let go of one first, then I can add this.' };
      return { entries: null, text: 'I could not keep that name. Say it another way?' };
    }
    if (outcome.kept !== 'goal') return { entries: null, text: '' };
    const goal = outcome.goal;
    const amount = formatNaira(kobo(goal.amountMinor));
    if (!goal.by) return { entries: outcome.entries, text: `Got it: ${goal.name}, ${amount}. I will keep track of it.` };
    const progress = facts.savingsMinor !== null ? goalProgress(goal, facts.savingsMinor, today) : null;
    const monthly = progress?.monthlyNeedMinor && progress.monthsLeft !== null && progress.monthsLeft >= 1
      ? ` That is about ${formatNaira(kobo(progress.monthlyNeedMinor))} a month.`
      : '';
    return { entries: outcome.entries, text: `Got it: ${goal.name}, ${amount} by ${dayWords(goal.by)}.${monthly} I will keep track.` };
  }
  if (action.do === 'prefer') {
    const outcome = changeMemory(memory, { kind: 'prefer', key: action.key, value: action.value }, context);
    if (!outcome.ok) {
      return {
        entries: null,
        text: action.key === 'payday'
          ? 'Which day of the month does your pay usually come in?'
          : action.key === 'savings-share'
            ? 'Say a share between 1 and 50 percent.'
            : 'I can answer in plain English, in Pidgin, or short.',
      };
    }
    if (outcome.kept !== 'pref') return { entries: null, text: '' };
    const value = outcome.value;
    const text = action.key === 'payday'
      ? `Okay, payday is the ${ordinal(value as number)}. I will plan around it.`
      : action.key === 'savings-share'
        ? `Okay. When money comes in, I will offer ${(value as number) / 100}% of it to savings.`
        : value === 'pidgin'
          ? 'No wahala. I will talk Pidgin where I can, and keep the figures plain.'
          : value === 'short'
            ? 'Okay, I will keep it short.'
            : 'Okay, plain English it is.';
    return { entries: outcome.entries, text };
  }
  if (action.do === 'remind') {
    const outcome = changeMemory(memory, { kind: 'remind', what: action.what, when: action.when }, context);
    if (!outcome.ok) {
      if (outcome.why === 'bad-when') return { entries: null, text: 'When should I remind you? Say a day, like tomorrow or Friday.' };
      if (outcome.why === 'too-many') return { entries: null, text: 'You have a lot of reminders open. Clear one first.' };
      return { entries: null, text: 'I could not keep that one. Say it another way?' };
    }
    if (outcome.kept !== 'reminder') return { entries: null, text: '' };
    const { reminder } = outcome;
    return { entries: outcome.entries, text: `Okay. I will bring it up when you open Entole ${whenWords(reminder.due, today)}: ${reminder.what}.` };
  }
  const outcome = changeMemory(memory, { kind: 'forget', what: action.what }, context);
  if (!outcome.ok) {
    if (outcome.why === 'several') return { entries: null, text: `Which one: ${(outcome.names ?? []).join(' or ')}?` };
    return { entries: null, text: 'I do not have anything saved by that name.' };
  }
  return { entries: outcome.entries, text: `Done. I have let go of ${outcome.kept === 'forgot' ? outcome.names.join(' and ') : 'it'}.` };
}

/**
 * Everything a reply asks for, as steps, in order. Facts are spoken from
 * `facts`; a payment is planned against the account as it stands. What the
 * reader wanted said is said first, unless a step has something truer to say.
 */
export async function planReply(
  reply: AssistantReply,
  account: AssistantAccount,
  facts: AssistantFacts,
  deps: Parameters<typeof planPayment>[2] & {
    /** The person is part-way through something (a payment being filled in, say). A fact is then only said, and they are not moved. */
    stay?: boolean;
  },
): Promise<AssistantStep[]> {
  const steps: AssistantStep[] = [];
  const now = new Date((deps.now ?? Date.now)());
  const turn = facts.turn ?? 0;
  // Memory changes in this reply build on each other.
  let memory = facts.memory;
  /** The facts as they stand after anything remembered in this reply. */
  const current = (): AssistantFacts => ({ ...facts, memory });
  const offerTop = () => {
    const top = nudgesFrom(current(), now).find((nudge) => nudge.action);
    if (top?.action) steps.push({ kind: 'offer', step: top.action.step, nudgeId: top.id });
  };

  for (const action of reply.actions) {
    if (action.do === 'open') steps.push({ kind: 'open', screen: action.screen });
    else if (action.do === 'tell') {
      const screen = FACT_SCREEN[action.about];
      if (!deps.stay && screen) steps.push({ kind: 'open', screen });
      steps.push({ kind: 'say', text: tellAbout(action.about, current(), now) });
      if (action.about === 'whats-new') offerTop();
    }
    else if (action.do === 'afford') {
      if (!deps.stay) steps.push({ kind: 'open', screen: 'plan' });
      steps.push({ kind: 'say', text: tellAfford(toMinor(action.amount) ?? 0, facts.picture, turn) });
    }
    else if (action.do === 'pay') steps.push(...(await planPayment(action, account, deps)));
    else if (action.do === 'request') {
      const amountMinor = toMinor(action.amount);
      steps.push({ kind: 'request', ...(amountMinor !== undefined ? { amountMinor } : {}) });
    } else if (action.do === 'save' || action.do === 'take-out') {
      const amountMinor = toMinor(action.amount);
      steps.push({
        kind: 'savings',
        mode: action.do === 'save' ? 'deposit' : 'withdraw',
        ...(amountMinor !== undefined ? { amountMinor } : {}),
      });
    } else if (action.do === 'bill') {
      const amountMinor = toMinor(action.amount);
      steps.push({
        kind: 'bill',
        ...(action.kind ? { category: action.kind } : {}),
        ...(amountMinor !== undefined ? { amountMinor } : {}),
      });
    } else if (action.do === 'goal' || action.do === 'prefer' || action.do === 'remind' || action.do === 'forget') {
      if (!memory) {
        steps.push({ kind: 'say', text: 'I could not reach what I remember just now, so nothing was saved. Try again in a moment.' });
        continue;
      }
      const planned = planMemory(action, memory, current(), now);
      if (planned.entries) {
        memory = planned.entries;
        steps.push({ kind: 'remember', entries: planned.entries });
      }
      if (planned.text) steps.push({ kind: 'say', text: planned.text });
    } else if (action.do === 'checkin') {
      const nudges = nudgesFrom(current(), now);
      const checkin = facts.lines?.length ? buildCheckin(facts.lines, lagosToday(now)) : null;
      steps.push({ kind: 'say', text: checkinWords(checkin, nudges[0] ?? null) });
      if (checkin && nudges[0]?.action) steps.push({ kind: 'offer', step: nudges[0].action.step, nudgeId: nudges[0].id });
    } else if (action.do === 'explain') {
      steps.push({ kind: 'say', text: explain(action.topic) });
    } else if (action.do === 'swap') {
      if (action.from === action.to) {
        steps.push({ kind: 'say', text: 'Those are the same currency. Which one should it become?' });
        continue;
      }
      const amountCents = toMinor(action.amount);
      steps.push({ kind: 'swap', from: action.from, to: action.to, ...(amountCents !== undefined ? { amountCents } : {}) });
    } else if (action.do === 'add-to-pocket') {
      steps.push({ kind: 'add-to-pocket', ...(action.pocket ? { pocket: action.pocket } : {}) });
    }
    else steps.push({ kind: 'pause', paused: action.do === 'pause' });
  }
  // The app's own words about what it did win over the reader's. With neither,
  // it at least says where it is going: someone talking is not looking.
  const spoke = steps.some((step) => step.kind === 'say');
  if (!spoke && reply.say) steps.unshift({ kind: 'say', text: reply.say });
  else if (!spoke) {
    const first = steps.find((step) => step.kind !== 'remember' && step.kind !== 'offer');
    const words = first ? stepWords(first, turn) : null;
    if (words) steps.unshift({ kind: 'say', text: words });
  }
  return steps;
}

/** Whether a reply needs the money picture, so it is only built when it is asked about. */
export function asksPicture(reply: AssistantReply): boolean {
  return reply.actions.some(
    (action) =>
      action.do === 'afford' ||
      action.do === 'checkin' ||
      (action.do === 'tell' && ['balance', 'safe-to-spend', 'leaks', 'subscriptions', 'picture', 'tax', 'whats-new'].includes(action.about)),
  );
}
