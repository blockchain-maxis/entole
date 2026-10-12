'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { useBackend } from '@entole/core/backend';
import { DirectoryError } from '@entole/core/directory';
import { initialsFor } from '@entole/core/profile';

import { useAccount } from './account';

const CLAIM_KEY = 'entole.username.claimed';
const recordOf = (address: string, username: string) => `${address.toLowerCase()}:${username}`;

function readRecord(): string | null {
  try {
    return window.localStorage.getItem(CLAIM_KEY);
  } catch {
    return null;
  }
}

/** Remembers that the directory accepted this username for this account, so it is not asked again on every visit. */
export function recordUsernameClaim(address: string, username: string): void {
  try {
    window.localStorage.setItem(CLAIM_KEY, recordOf(address, username));
  } catch {
    // Without storage the claim is simply made again next time; it is harmless to repeat.
  }
}

/**
 * Whether this account's username is its own in the directory.
 *
 * - `pending`: not known yet, or the directory could not be reached.
 * - `held`: it is theirs. People can find and pay them by it.
 * - `taken`: someone else has it. They need to choose another.
 */
export type UsernameClaim = 'pending' | 'held' | 'taken';

const ClaimContext = createContext<UsernameClaim>('pending');

export function useUsernameClaim(): UsernameClaim {
  return useContext(ClaimContext);
}

/**
 * Claims the signed-in person's username in the directory and says how that
 * went. It runs for every account, including ones made before usernames were
 * kept anywhere but the device: the first of two people who chose the same name
 * to open the app holds it, and the other is told to choose again.
 *
 * It tries again each time the page comes back into view, until the directory
 * has said yes or no. Trying once left a name unclaimed, and so free for
 * someone else to take, whenever that one try could not get through.
 */
export function UsernameClaimProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const backend = useBackend();
  const [result, setResult] = useState<{ record: string; claim: UsernameClaim } | null>(null);
  /** Bumped when the page comes back into view, to try an unanswered claim again. */
  const [returned, setReturned] = useState(0);

  const address = account?.owner.address;
  const username = account?.username;
  const displayName = account?.displayName;
  const record = address && username ? recordOf(address, username) : null;

  const answered = result?.record === record;

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') setReturned((count) => count + 1);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    // Asked and answered, yes or no: nothing more to do for this name.
    if (!address || !username || !displayName || !record || answered) return;
    let live = true;
    void (async () => {
      if (readRecord() === record) {
        if (live) setResult({ record, claim: 'held' });
        return;
      }
      try {
        await backend.directory.claim({
          address,
          name: displayName,
          initials: initialsFor(displayName),
          tone: 1,
          username,
        });
        recordUsernameClaim(address, username);
        if (live) setResult({ record, claim: 'held' });
      } catch (error) {
        if (live && error instanceof DirectoryError && error.code === 'username_taken') {
          setResult({ record, claim: 'taken' });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [address, username, displayName, record, backend, answered, returned]);

  const claim = result && result.record === record ? result.claim : 'pending';
  return <ClaimContext.Provider value={claim}>{children}</ClaimContext.Provider>;
}
