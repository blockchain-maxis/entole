import { keccak256, toHex, type Address } from 'viem';

/**
 * Off-UI address resolution for the demo fixture contacts in `fixtures.ts`
 * (Mom, Chidi, Ada, ...). These are not real people — they're the same
 * fixture identities the whole app already renders everywhere — so a
 * deterministic address per fixture contact id is not "mocking settlement":
 * the transfer a screen triggers still executes for real on
 * `EntolePolicy`/the settlement token. This file exists only so an address,
 * which must never reach the UI or any schema, has somewhere off-screen to
 * live. A real contact-onboarding flow (a recipient registering their own
 * account) replaces this file; it does not extend it.
 */
function deterministicAddress(contactId: string): Address {
  return keccak256(toHex(`entole.address-book.v1.${contactId}`)).slice(0, 42) as Address;
}

const FIXTURE_CONTACT_IDS = [
  'c-mom',
  'c-chidi',
  'c-ada',
  'c-tunde',
  'c-ngozi-udo',
  'c-aunt-ngozi',
  'c-emeka',
] as const;

const ADDRESS_BOOK: Record<string, Address> = Object.fromEntries(
  FIXTURE_CONTACT_IDS.map((id) => [id, deterministicAddress(id)]),
);

const CONTACT_BY_ADDRESS: Record<string, string> = Object.fromEntries(
  Object.entries(ADDRESS_BOOK).map(([contactId, address]) => [address.toLowerCase(), contactId]),
);

/** Throws for an unresolvable contact rather than guessing an address. */
export function resolveRecipient(contactId: string): Address {
  const address = ADDRESS_BOOK[contactId];
  if (!address) throw new Error(`No settlement address on file for contact ${contactId}`);
  return address;
}

/** The reverse lookup — used to turn an indexed on-chain recipient address
 * back into the contact id a screen can render. `undefined` for an address
 * outside the fixture book (e.g. a real recipient once contacts register
 * their own accounts); the caller decides whether to drop that entry rather
 * than guess a name for it. */
export function resolveContactId(address: Address): string | undefined {
  return CONTACT_BY_ADDRESS[address.toLowerCase()];
}
