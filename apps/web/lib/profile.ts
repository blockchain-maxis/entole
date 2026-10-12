'use client';

import { initialsFor } from '@entole/core/profile';

import { useAccount } from './account';

export type ProfileView = {
  fullName: string;
  /** The one handle a person has: how they are found and paid. */
  username: string;
  initials: string;
};

/** Who is signed in, ready to render. `null` until an account is in memory.
 * Pages get a name and a username, and never the account's address. */
export function useProfile(): ProfileView | null {
  const { account } = useAccount();
  if (!account) return null;
  return {
    fullName: account.displayName,
    username: account.username,
    initials: initialsFor(account.displayName),
  };
}
