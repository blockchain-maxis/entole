import { getAddress } from 'viem';

import { parseCheckout, parsePayLink, type Checkout, type PayRequest } from './checkout-link';
import { parseHandle, resolveHandle, type Handle, type HandleDirectory } from './handle';
import { encodePaymentCode } from './payment-code';
import { parsePhoneLink } from './phone-link';

/**
 * Who a piece of text is asking to pay. One door for every way it arrives:
 * typed into a field, pasted, scanned from a square, or handed over by a link
 * opened from another app. A person is named by their username or their phone
 * number; a pay link is their username with an amount on it.
 *
 * Two steps, because only the second needs the network. `readRecipient` says
 * what the text names. `findRecipient` asks the directory who that is.
 */
export type Sought =
  /** A username or a number, and whatever the link around it asked for. */
  | { kind: 'handle'; handle: Handle; request: PayRequest | null }
  /** A link in the old form, which says where the money goes by itself. */
  | { kind: 'known'; checkout: Checkout };

/** What the text names, or `null` when it names nobody. Never touches the network. */
export function readRecipient(input: string): Sought | null {
  const text = input.trim();
  if (!text) return null;

  const link = parsePayLink(text);
  if (link) {
    const { username, ...request } = link;
    return { kind: 'handle', handle: { kind: 'username', username }, request };
  }

  const old = parseCheckout(text);
  if (old) return { kind: 'known', checkout: old };

  const phone = parsePhoneLink(text);
  if (phone) return { kind: 'handle', handle: { kind: 'phone', phone }, request: null };

  const handle = parseHandle(text);
  return handle ? { kind: 'handle', handle, request: null } : null;
}

/**
 * Who it is, as a checkout: where the money goes, the name the directory has
 * for them, and what the link asked for. `null` when nobody holds that
 * username or number. The name always comes from the directory, never from
 * the text, so a link cannot dress one person up as another.
 */
export async function findRecipient(directory: HandleDirectory, sought: Sought): Promise<Checkout | null> {
  if (sought.kind === 'known') return sought.checkout;

  const identity = await resolveHandle(directory, sought.handle);
  if (!identity) return null;

  let address;
  try {
    address = getAddress(identity.address);
  } catch {
    return null;
  }
  const username = identity.username ?? (sought.handle.kind === 'username' ? sought.handle.username : undefined);

  return {
    code: encodePaymentCode(address),
    address,
    ...(sought.request ?? { kind: 'pay' as const }),
    payee: identity.name,
    ...(username ? { username } : {}),
  };
}
