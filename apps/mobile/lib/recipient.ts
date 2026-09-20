import { entryFromMinor, EMPTY_ENTRY, type AmountEntry } from '@entole/core/amount-entry';
import { kobo } from '@entole/core/money';
import { oneOffId } from '@entole/core/one-off';
import { parseCheckout } from '@entole/core/checkout-link';

/**
 * How typed, pasted and scanned text becomes a send. One door: a checkout
 * link, a `/pay/…` path, a deep link and a bare payment code all read the same,
 * so pasting and scanning cannot drift apart.
 */

export type SendParams = {
  contactId: string;
  /** Integer minor units (kobo), as a string, to pre-fill the keypad. */
  amount?: string;
  note?: string;
};

/** The longest note the review sheet's field takes. */
export const NOTE_MAX = 80;

/** A note from a route param or a link, made safe to pre-fill: trimmed and cut to length. */
export function cleanNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, NOTE_MAX).trim();
  return trimmed || undefined;
}

/**
 * The route params for sending to whatever `text` names, or `null` when it does
 * not carry a valid code. A link's amount only pre-fills when it is in naira —
 * an amount in another currency is not guessed at. `note` from the caller wins
 * over a note inside the link.
 */
export function sendParamsFor(text: string, note?: string): SendParams | null {
  const parsed = parseCheckout(text);
  if (!parsed) return null;
  const contactId = oneOffId(parsed.code);
  if (!contactId) return null;

  const chosenNote = cleanNote(note) ?? cleanNote(parsed.note);
  return {
    contactId,
    ...(parsed.amountMinor !== undefined && parsed.currency === 'NGN'
      ? { amount: String(parsed.amountMinor) }
      : {}),
    ...(chosenNote ? { note: chosenNote } : {}),
  };
}

/** Starting keypad entry for an `amount` route param; empty when it is missing or does not fit. */
export function entryFromParam(value: unknown): AmountEntry {
  if (typeof value !== 'string' || !/^\d{1,13}$/.test(value)) return EMPTY_ENTRY;
  const minor = Number(value);
  if (!Number.isSafeInteger(minor) || minor <= 0) return EMPTY_ENTRY;
  const entry = entryFromMinor(kobo(minor));
  // The keypad holds nine whole digits; anything larger is not a payment this screen can show.
  return entry.raw.split('.')[0]!.length > 9 ? EMPTY_ENTRY : entry;
}
