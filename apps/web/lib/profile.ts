'use client';

import { entoleCode, initialsFor } from '@entole/core/profile';

import { useAccount } from './account';

export type ProfileView = {
  fullName: string;
  username: string;
  /** "ENT-XXXX-XXXX" — the person's unique handle, derived from their account
   * but never containing it. */
  code: string;
  initials: string;
};

/** Who is signed in, ready to render. `null` until an account is in memory.
 * The account's address is read here, once, only to derive the code — pages
 * get the code and never the address. */
export function useProfile(): ProfileView | null {
  const { account } = useAccount();
  if (!account) return null;
  return {
    fullName: account.displayName,
    username: account.username,
    code: entoleCode(account.owner.address),
    initials: initialsFor(account.displayName),
  };
}
