import { entryToMinor } from './amount-entry';
import type { Naira } from './money';
import type { Contact } from './schemas';

/**
 * Turns a Telegram message into the same shape the app's own proposal
 * builder produces — see docs/SCOPE.md's "Telegram as a second intake
 * surface." Whatever comes out of this still runs the same undo window
 * before anything settles; nothing here gets a shortcut past it.
 *
 * This is a deterministic fallback grammar, not the real thing — the
 * bounty table in docs/SCOPE.md calls for an LLM (Qwen/Kimi/Hunyuan) to do
 * this parsing for real. Swapping this function's body for a model call is
 * a one-file change, same pattern as `gateway.ts`'s demo/on-chain split.
 */

export type ParsedIntent =
  | { ok: true; contactId: string; amountMinor: Naira; note: string }
  | { ok: false; reason: string };

const PAY_VERB = /^(pay|send)\b/i;
const AMOUNT = /(?:₦|ngn)?\s*([\d,]+(?:\.\d{1,2})?)/i;
const TO_CLAUSE = /\bto\s+([a-z][a-z\s]*?)(?=\s+\b(?:for|note:)\b|$)/i;
const NOTE_CLAUSE = /\b(?:for|note:)\s+(.+)$/i;

export function parseTelegramMessage(text: string, contacts: Contact[]): ParsedIntent {
  const trimmed = text.trim();
  if (!PAY_VERB.test(trimmed)) {
    return { ok: false, reason: 'Start with "pay" or "send" — e.g. "Pay 5000 to Mom for rent".' };
  }

  const amountMatch = trimmed.match(AMOUNT);
  if (!amountMatch?.[1]) return { ok: false, reason: 'Could not find an amount.' };
  const amountMinor = entryToMinor({ raw: amountMatch[1].replace(/,/g, '') });
  if (amountMinor <= 0) return { ok: false, reason: 'Amount must be greater than zero.' };

  const toMatch = trimmed.match(TO_CLAUSE);
  if (!toMatch?.[1]) return { ok: false, reason: 'Say who it goes to — e.g. "to Mom".' };
  const name = toMatch[1].trim().toLowerCase();

  const contact = contacts.find((c) => {
    const full = c.name.toLowerCase();
    return full === name || full.split(' ')[0] === name || full.startsWith(name);
  });
  if (!contact) return { ok: false, reason: `No contact matches "${toMatch[1].trim()}".` };

  const noteMatch = trimmed.match(NOTE_CLAUSE);
  const note = noteMatch?.[1]?.trim() || 'Sent from Telegram';

  return { ok: true, contactId: contact.id, amountMinor, note };
}
