import type { Address } from 'viem';

import { decodePaymentCode, encodePaymentCode } from './payment-code';
import { initialsFor } from './profile';
import type { Contact } from './schemas';

/**
 * Paying a payment code without saving the person first.
 *
 * A saved beneficiary is a record with an id. A one-off recipient has no record
 * — its id *is* the payment code, `code:PAY-XXXX-…` — so the send flow, the
 * receipt and the activity list can all name them without anything being
 * stored. The screens see a `Contact` built from the code, never an address.
 *
 * A payment link may also name the person being paid (the `payee` on a
 * checkout). When it does, that name rides inside the id as a second segment,
 * `code:PAY-XXXX-…#<name>`, so it shows on the send screen, the review sheet,
 * the receipt and the activity feed without a display-name field on any record.
 * The name is only ever a label; where the money lands still comes from the
 * code alone.
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
 * The recipient id for a payment code, or `null` if the code isn't valid. A
 * `name` (the payee on a payment link) is carried alongside the code so the
 * person shows by name everywhere; it never affects where the money goes.
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

/** The payment code inside a one-off id, for pre-filling "save as beneficiary". */
export function oneOffCode(id: string): string | null {
  const address = oneOffAddress(id);
  return address ? encodePaymentCode(address) : null;
}

/**
 * How a one-off recipient is shown: the name on their payment link when it
 * carried one, otherwise the end of their code — never an address.
 */
export function oneOffContact(id: string): Contact | undefined {
  if (!isOneOffId(id)) return undefined;
  const code = oneOffCode(id);
  if (!code) return undefined;
  const { name } = parts(id);
  if (name) return { id, name, initials: initialsFor(name), tone: 3 };
  const tail = code.split('-').slice(-1)[0] ?? code.slice(-4);
  return { id, name: `Payment code · ${tail}`, initials: 'PC', tone: 3 };
}
