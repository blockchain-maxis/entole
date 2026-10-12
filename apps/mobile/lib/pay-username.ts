import { useCallback, useEffect, useState } from 'react';

import { useBackend } from '@entole/core/backend';

import { useAccount } from './account';
import { recordUsernameClaim, usernameClaimRecorded } from './session';

/**
 * The username this person is paid by, once the directory has said it is
 * theirs. Their pay link, their QR and every invoice are made from it, so a
 * screen waits for `held` before it shows any of them: a link that might lead
 * to someone else is worse than no link.
 *
 * - `checking`: not known yet.
 * - `held`: it is theirs.
 * - `unconfirmed`: the directory has not said so. Either it could not be
 *   reached, or someone else has the name and they need to choose another.
 */
export type PayUsername =
  | { state: 'checking' }
  | { state: 'held'; username: string }
  | { state: 'unconfirmed'; username: string | null };

export function usePayUsername(): PayUsername & { retry: () => void } {
  const { account } = useAccount();
  const backend = useBackend();
  const address = account?.owner.address;
  const username = account?.username || null;
  const [found, setFound] = useState<{ key: string; held: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${address ?? ''}:${username ?? ''}:${attempt}`;

  useEffect(() => {
    if (!address || !username) return;
    let live = true;
    void (async () => {
      // The tabs claim the name when the app opens and remember the answer.
      let held = await usernameClaimRecorded(address, username).catch(() => false);
      if (!held) {
        // Not remembered here: ask who has it. If it is this account, it is theirs.
        const owner = await backend.directory.resolveByUsername(username).catch(() => null);
        held = owner?.address.toLowerCase() === address.toLowerCase();
        if (held) await recordUsernameClaim(address, username).catch(() => undefined);
      }
      if (live) setFound({ key, held });
    })();
    return () => {
      live = false;
    };
  }, [address, username, backend, key]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  if (!account || !username) return { state: 'unconfirmed', username: null, retry };
  if (found?.key !== key) return { state: 'checking', retry };
  return found.held ? { state: 'held', username, retry } : { state: 'unconfirmed', username, retry };
}
