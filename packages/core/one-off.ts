import type { Address } from 'viem';

import { decodePaymentCode, encodePaymentCode } from './payment-code';
import { initialsFor } from './profile';
import type { Contact } from './schemas';

/**
 * Paying someone without saving them first.
 *
 * A saved beneficiary is a record with an id. A one-off recipient has no record
 * — its id carries where the money goes, `code:PAY-XXXX-…`, the form records
 * keep an account in — so the send flow, the receipt and the activity list can
 * all name them without anything being stored. The screens see a `Contact`
 * built from it, never an address and never the code.
 *
 * The id also carries who the person is: the name the directory has for the
 * username or number they were found by. It rides as a second segment,
 * `code:PAY-XXXX-…#<name>`, so it shows on the send screen, the review sheet,
 * the receipt and the activity feed without a display-name field on any record.
 * The name is only ever a label; where the money lands comes from the first
 * segment alone.
 */
export const ONE_OFF_PREFIX = 'code:';

/** Separates the payment code from an optional display name inside a one-off id. */
const NAME_SEP = '#';

/** The longest display name a one-off id carries, before encoding. */
const NAME_MAX = 40;

/** A link-supplied name made safe to carry: trimmed, whitespace collapsed, capped. */
function cleanName(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return trimmed || undefined;
}

/** Splits a one-off id into its code and, when present, its display name. */
function parts(id: string): { code: string; name?: string } {
  const body = id.slice(ONE_OFF_PREFIX.length);
  const at = body.indexOf(NAME_SEP);
  if (at < 0) return { code: body };
  let name: string | undefined;
  try {
    name = cleanName(decodeURIComponent(body.slice(at + 1)));
  } catch {
    name = undefined;
  }
  return { code: body.slice(0, at), ...(name ? { name } : {}) };
}

/**
 * The recipient id for an account, or `null` if it isn't a valid one. A `name`
 * is carried alongside so the person shows by name everywhere; it never
 * affects where the money goes.
 */
export function oneOffId(paymentCode: string, name?: string): string | null {
  const address = decodePaymentCode(paymentCode);
  if (!address) return null;
  const base = `${ONE_OFF_PREFIX}${encodePaymentCode(address)}`;
  const clean = cleanName(name);
  return clean ? `${base}${NAME_SEP}${encodeURIComponent(clean)}` : base;
}

export function isOneOffId(id: string): boolean {
  return id.startsWith(ONE_OFF_PREFIX);
}

/** Where a one-off recipient's money lands — `null` if the id isn't a valid one. */
export function oneOffAddress(id: string): Address | null {
  return isOneOffId(id) ? decodePaymentCode(parts(id).code) : null;
}

/** The account inside a one-off id, in the form records keep it. Not for a screen. */
export function oneOffCode(id: string): string | null {
  const address = oneOffAddress(id);
  return address ? encodePaymentCode(address) : null;
}

/** The name a one-off recipient was found under, when there is one. */
export function oneOffName(id: string): string | undefined {
  return isOneOffId(id) ? parts(id).name : undefined;
}

/** What someone is called when nothing gave them a name. */
export const UNNAMED_RECIPIENT = 'Entole account';

/**
 * How a one-off recipient is shown: by name. Someone found by username or
 * number always has one. A link in the old form may not, and then they are
 * simply an Entole account: never an address, never a code.
 */
export function oneOffContact(id: string): Contact | undefined {
  if (!isOneOffId(id)) return undefined;
  if (!oneOffAddress(id)) return undefined;
  const { name } = parts(id);
  if (name) return { id, name, initials: initialsFor(name), tone: 3 };
  return { id, name: UNNAMED_RECIPIENT, initials: 'E', tone: 3 };
}
