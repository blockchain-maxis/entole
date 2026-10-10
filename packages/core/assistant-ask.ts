import type { Allowance, Contact, Proposal } from './schemas';
import { parseTelegramMessage } from './telegram-intake';

/**
 * Asking the assistant from inside the app: a sentence in, a proposal out.
 *
 * This is the same step the Telegram intake does on the server, done on the
 * device so it needs no inbox and no chat. The proposal it makes is the same
 * object and runs the same undo window. It carries no authority: whether the
 * payment may happen is decided by the allowance on the contract when the
 * assistant's key tries to run it, never here. That is why nothing below
 * checks the amount against the limit. A request past the limit becomes a
 * proposal like any other, and is refused where refusing counts.
 *
 * Reading the sentence is the plain grammar for now ("Pay 5000 to Ada for
 * rent"). A language model slots in behind the same function when a key
 * exists; what it returns still becomes this proposal and nothing more.
 */

/** Long enough to read and stop, short enough to feel like it is happening. */
export const ASK_UNDO_SECONDS = 10;

const DEFAULT_NOTE = 'Asked in the app';

export type AskResult = { ok: true; proposal: Proposal } | { ok: false; reason: string };

export function proposeFromRequest(
  text: string,
  account: { contacts: Contact[]; allowances: Allowance[] },
  options: { now?: () => number } = {},
): AskResult {
  const intent = parseTelegramMessage(text, account.contacts, DEFAULT_NOTE);
  if (!intent.ok) {
    // The app calls them saved people, never "contacts".
    const unknown = /^No contact matches ("[^"]*")\.$/.exec(intent.reason);
    return unknown ? { ok: false, reason: `You haven't saved anyone called ${unknown[1]} yet.` } : intent;
  }

  const contact = account.contacts.find((entry) => entry.id === intent.contactId);
  const firstName = contact?.name.split(' ')[0] ?? 'them';
  const allowances = account.allowances.filter((entry) => entry.recipientId === intent.contactId);
  if (allowances.length === 0) {
    return { ok: false, reason: `The assistant has no allowance for ${firstName} yet. Set one up first.` };
  }
  const allowance = allowances.find((entry) => !entry.paused);
  if (!allowance) {
    return { ok: false, reason: `The allowance for ${firstName} is paused. Resume it first.` };
  }

  return {
    ok: true,
    proposal: {
      id: `ask-${(options.now ?? Date.now)().toString(36)}`,
      allowanceId: allowance.id,
      contactId: intent.contactId,
      amountMinor: intent.amountMinor,
      note: intent.note,
      undoSeconds: ASK_UNDO_SECONDS,
    },
  };
}

/**
 * Where a proposal asked for in the app waits. In memory, for this session
 * only: a reload drops it, which is the same as stopping it, and that is the
 * safe way for a pending payment to be forgotten.
 */
export type ProposalSlot = {
  read(): Proposal | null;
  put(proposal: Proposal): void;
  clear(): void;
};

export function createProposalSlot(): ProposalSlot {
  let waiting: Proposal | null = null;
  return {
    read: () => waiting,
    put: (proposal) => {
      waiting = proposal;
    },
    clear: () => {
      waiting = null;
    },
  };
}

/** What screens see before an account exists. */
export const emptyProposalSlot: ProposalSlot = { read: () => null, put: () => undefined, clear: () => undefined };
