import type { Address } from 'viem';

import { decodePaymentCode, encodePaymentCode } from './payment-code';
import type { Contact } from './schemas';

/**
 * Paying a payment code without saving the person first.
 *
 * A saved beneficiary is a record with an id. A one-off recipient has no record
 * — its id *is* the payment code, `code:PAY-XXXX-…` — so the send flow, the
 * receipt and the activity list can all name them without anything being
 * stored. The screens see a `Contact` built from the last characters of the
 * code, never an address.
 */
export const ONE_OFF_PREFIX = 'code:';

/** The recipient id for a payment code, or `null` if the code isn't valid. */
export function oneOffId(paymentCode: string): string | null {
  const address = decodePaymentCode(paymentCode);
  return address ? `${ONE_OFF_PREFIX}${encodePaymentCode(address)}` : null;
}

export function isOneOffId(id: string): boolean {
  return id.startsWith(ONE_OFF_PREFIX);
}

/** Where a one-off recipient's money lands — `null` if the id isn't a valid one. */
export function oneOffAddress(id: string): Address | null {
  return isOneOffId(id) ? decodePaymentCode(id.slice(ONE_OFF_PREFIX.length)) : null;
}

/** The payment code inside a one-off id, for pre-filling "save as beneficiary". */
export function oneOffCode(id: string): string | null {
  const address = oneOffAddress(id);
  return address ? encodePaymentCode(address) : null;
}

/** How a one-off recipient is shown: the end of their code, nothing else. */
export function oneOffContact(id: string): Contact | undefined {
  const code = oneOffCode(id);
  if (!code) return undefined;
  const tail = code.split('-').slice(-1)[0] ?? code.slice(-4);
  return { id, name: `Payment code · ${tail}`, initials: 'PC', tone: 3 };
}
