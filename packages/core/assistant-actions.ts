import { z } from 'zod';

import type { AllowanceView } from './allowance';
import { ASK_UNDO_SECONDS } from './assistant-ask';
import { relativeMoment } from './format';
import type { HandleDirectory } from './handle';
import { formatNaira, kobo } from './money';
import { oneOffId } from './one-off';
import { findRecipient, readRecipient } from './recipient';
import type { Activity, Contact, Proposal } from './schemas';

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
};

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
  z.object({ do: z.literal('bill'), kind: z.enum(['electricity', 'airtime-data', 'cable-tv', 'internet']).optional() }),
  /** Say something the app knows. The app supplies the facts, never the reader. */
  z.object({ do: z.literal('tell'), about: z.enum(['balance', 'recent', 'allowances', 'savings', 'username']) }),
  z.object({ do: z.literal('pause') }),
  z.object({ do: z.literal('resume') }),
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

/** "5000", "5,000", "₦5000", "5k", "2.5k", "1.5m", "5000 naira". `null` when it is not an amount. */
export function parseSpokenAmount(text: string): number | null {
  const match = /^(?:₦|ngn|n)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:naira|ngn)?$/i.exec(text.trim());
  if (!match) return null;
  const base = Number(match[1]!.replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unit = match[2]?.toLowerCase();
  const scale = unit === 'k' || unit === 'thousand' ? 1_000 : unit === 'm' || unit === 'million' ? 1_000_000 : 1;
  const amount = Math.round(base * scale * 100) / 100;
  return amount > 0 && amount <= 1_000_000_000 ? amount : null;
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

/**
 * Reads the sentences that can only mean one thing: "send 5,000 to Ada for
 * rent", "open receive", "what's my balance". `null` for anything else, which
 * is the cue to ask a language model, or, with none to ask, to say so.
 *
 * It is deliberately narrow. A grammar that guesses turns "5k" into five
 * naira; this one either knows or stays quiet.
 */
export function readPlainRequest(input: string): AssistantReply | null {
  const text = input
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');
  if (!text) return null;
  const lower = text.toLowerCase().replace(/^(?:please|hey entole|entole|ok|okay)[, ]+/, '');
  const offset = text.length - lower.length;
  const original = text.slice(offset);

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
    if (amount && to && !/\s(?:and|then)\s/i.test(to)) {
      return { actions: [{ do: 'pay', to, amount, ...(paid.note ? { note: paid.note.trim().slice(0, 80) } : {}) }] };
    }
    return null;
  }
  const payNoAmount = /^(?:pay|send money to|send to)\s+(.+)$/i.exec(original);
  if (payNoAmount && !/\d/.test(payNoAmount[1]!) && !/\s(?:and|then)\s/i.test(payNoAmount[1]!)) {
    return { actions: [{ do: 'pay', to: payNoAmount[1]!.trim() }] };
  }

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
};

/** A fact, in a sentence a person would say. Every figure is the app's own. */
export function tellAbout(about: Extract<AssistantAction, { do: 'tell' }>['about'], facts: AssistantFacts, now = new Date()): string {
  if (about === 'balance') return `You have ${formatNaira(kobo(facts.balanceMinor))}.`;
  if (about === 'username') return facts.username ? `Your username is @${facts.username}.` : 'You have not chosen a username yet.';
  if (about === 'savings') {
    return facts.savingsMinor && facts.savingsMinor > 0
      ? `You have ${formatNaira(kobo(facts.savingsMinor))} in savings.`
      : 'There is nothing in savings yet.';
  }
  if (about === 'allowances') {
    if (facts.allowances.length === 0) return 'The assistant has no allowance yet, so it cannot pay anyone on its own.';
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
        ? `The assistant sent ${amount} to ${who}, ${when}.`
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
  const exact = contacts.filter((contact) => contact.name.toLowerCase() === name);
  if (exact.length === 1) return { kind: 'saved', contact: exact[0]! };
  const close = (exact.length > 1 ? exact : contacts).filter((contact) => {
    const full = contact.name.toLowerCase();
    return full === name || full.split(' ')[0] === name || full.startsWith(`${name} `);
  });
  if (close.length === 1) return { kind: 'saved', contact: close[0]! };
  if (close.length > 1) return { kind: 'several', names: close.map((contact) => contact.name).slice(0, 4) };
  return readRecipient(spoken) ? { kind: 'look-up' } : { kind: 'nobody' };
}

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
  | { kind: 'bill'; category?: string }
  | { kind: 'pause'; paused: boolean };

export type AssistantAccount = {
  contacts: readonly Contact[];
  allowances: readonly AllowanceView[];
  /** The assistant has been turned on to spend: it holds its own key and can run an allowance. */
  canSpend: boolean;
  paused: boolean;
};

const toMinor = (amount: number | undefined) => (amount === undefined ? undefined : Math.round(amount * 100));

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
        ? `${name}, ${amountWords}. Check it, then confirm it yourself.`
        : `Here is ${name}. Enter the amount, then confirm it yourself.`,
    },
  ];
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
  deps: Parameters<typeof planPayment>[2],
): Promise<AssistantStep[]> {
  const steps: AssistantStep[] = [];
  for (const action of reply.actions) {
    if (action.do === 'open') steps.push({ kind: 'open', screen: action.screen });
    else if (action.do === 'tell') steps.push({ kind: 'say', text: tellAbout(action.about, facts) });
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
    } else if (action.do === 'bill') steps.push({ kind: 'bill', ...(action.kind ? { category: action.kind } : {}) });
    else steps.push({ kind: 'pause', paused: action.do === 'pause' });
  }
  // The app's own words about what it did win over the reader's. With neither,
  // it at least says where it is going: someone talking is not looking.
  const spoke = steps.some((step) => step.kind === 'say');
  if (!spoke && reply.say) steps.unshift({ kind: 'say', text: reply.say });
  else if (!spoke) {
    const first = steps[0];
    const words =
      first?.kind === 'open'
        ? `Opening ${SCREEN_NAMES[first.screen]}.`
        : first?.kind === 'request'
          ? first.amountMinor !== undefined
            ? `Here is your link, asking for ${formatNaira(kobo(first.amountMinor))}.`
            : 'Here is how you get paid.'
          : first?.kind === 'savings'
            ? first.mode === 'deposit'
              ? 'Here is savings. You confirm what goes in.'
              : 'Here is savings. You confirm what comes out.'
            : first?.kind === 'bill'
              ? 'Here are your bills.'
              : null;
    if (words) steps.unshift({ kind: 'say', text: words });
  }
  return steps;
}
