import type { Address } from 'viem';

import { entryFromMinor, EMPTY_ENTRY, type AmountEntry } from '@entole/core/amount-entry';
import type { Backend } from '@entole/core/backend';
import type { Checkout } from '@entole/core/checkout-link';
import type { Handle } from '@entole/core/handle';
import { kobo } from '@entole/core/money';
import { oneOffId } from '@entole/core/one-off';
import { findRecipient, readRecipient } from '@entole/core/recipient';

/**
 * How typed, pasted and scanned text becomes a send. One door: a username, a
 * phone number, a pay link, a scanned square and a link opened from another
 * app all read the same (`readRecipient` in core), so they cannot drift apart.
 */

export type SendParams = {
  contactId: string;
  /** Integer minor units (kobo), as a string, to pre-fill the keypad. */
  amount?: string;
  note?: string;
  /** The invoice a link asks to be paid, carried in the payment so the business sees it paid. */
  reference?: string;
};

/** An invoice reference as a link carries it, or nothing. */
export function cleanReference(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,24}$/.test(value.trim()) ? value.trim() : undefined;
}

/** The longest note the review sheet's field takes. */
export const NOTE_MAX = 80;

/** A note from a route param or a link, made safe to pre-fill: trimmed and cut to length. */
export function cleanNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, NOTE_MAX).trim();
  return trimmed || undefined;
}

/**
 * The route params for sending to someone who has been found. A link's amount
 * only pre-fills when it is in naira — an amount in another currency is not
 * guessed at. `note` from the caller wins over a note inside the link.
 *
 * `resolveContactId` checks the account against saved beneficiaries first, so
 * paying someone already saved shows them as you saved them; the one-off id,
 * carrying the name the directory has, is for someone new.
 */
function paramsFor(
  found: Checkout,
  note?: string,
  resolveContactId?: (address: Address) => string | undefined,
): SendParams | null {
  const contactId = resolveContactId?.(found.address) ?? oneOffId(found.code, found.payee);
  if (!contactId) return null;

  const chosenNote = cleanNote(note) ?? cleanNote(found.note);
  return {
    contactId,
    ...(found.amountMinor !== undefined && found.currency === 'NGN' ? { amount: String(found.amountMinor) } : {}),
    ...(chosenNote ? { note: chosenNote } : {}),
    ...(found.kind === 'invoice' && cleanReference(found.reference) ? { reference: cleanReference(found.reference)! } : {}),
  };
}

/**
 * The route params for whatever `text` names, when that can be known without
 * asking anyone: a link in the form made before usernames, which says where
 * the money goes by itself. `null` for everything else, a username or a number
 * included: `resolveSendTarget` asks the directory about those.
 */
export function sendParamsFor(
  text: string,
  note?: string,
  resolveContactId?: (address: Address) => string | undefined,
): SendParams | null {
  const sought = readRecipient(text);
  return sought?.kind === 'known' ? paramsFor(sought.checkout, note, resolveContactId) : null;
}

/**
 * Who `text` names, as route params for the send screen. A username, a phone
 * number and a pay link all need the directory, so this is the one every
 * screen calls: the field, the scanner, paste, and a link opened from outside.
 *
 * `'unclaimed'` distinguishes "that's not something this app understands"
 * (`null`) from "that reads fine, but nobody has it" — worth telling apart in
 * the UI.
 */
export async function resolveSendTarget(
  text: string,
  note: string | undefined,
  backend: Pick<Backend, 'source' | 'directory'>,
): Promise<SendParams | null | 'unclaimed'> {
  const sought = readRecipient(text);
  if (!sought) return null;

  const found = await findRecipient(backend.directory, sought).catch(() => null);
  if (!found) return 'unclaimed';
  return paramsFor(found, note, backend.source.resolveContactId);
}

/**
 * The username or number in typed text, when it is one. Never touches the
 * network; `resolveSendTarget` asks the directory who it is.
 */
export function handleIn(text: string): Handle | null {
  const sought = readRecipient(text);
  return sought?.kind === 'handle' ? sought.handle : null;
}

/** The fields a pay link can carry after its `?`, as the router hands them over. */
const LINK_FIELDS = ['t', 'a', 'c', 'r', 'm', 'd', 'n'] as const;

/**
 * A pay link opened from outside the app (`entole://pay/@ada.eze?a=500000`),
 * put back together from what the router made of it, so it goes through the
 * same door as a link that was pasted or scanned. `null` when the route named
 * nobody.
 */
export function payLinkFromRoute(params: Record<string, unknown>): string | null {
  const raw = typeof params.code === 'string' ? params.code : '';
  let who = raw;
  try {
    who = decodeURIComponent(raw);
  } catch {
    // Left as it came; it will simply not read as anyone.
  }
  who = who.trim();
  if (!who || who.length > 80) return null;
  // A username written without its "@" is still a username.
  if (/^[a-z0-9_.]{3,20}$/i.test(who) && /[a-z]/i.test(who)) who = `@${who}`;

  const query = LINK_FIELDS.flatMap((key) => {
    const value = params[key];
    return typeof value === 'string' && value ? [`${key}=${encodeURIComponent(value.slice(0, 400))}`] : [];
  });
  return `/pay/${who}${query.length ? `?${query.join('&')}` : ''}`;
}

/** A path the lock screen may carry someone on to once they are back in: a pay link, nothing else. */
export function isPayPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2000 && /^\/pay\/[^/]+(\?.*)?$/.test(value);
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
