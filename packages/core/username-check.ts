import { useEffect, useState } from 'react';

import { lookupUsername } from './directory';
import { validateUsername } from './profile';

/**
 * Where a username stands while someone is choosing it.
 *
 * - `idle`: not a username yet (too short, a character that is not allowed).
 * - `checking`: asked, not answered.
 * - `free` / `taken`: what the directory said. One already held by the person
 *   asking counts as free: it is theirs.
 * - `unknown`: the directory could not be reached. Nothing is promised; the
 *   claim itself, made when they continue, is what decides.
 */
export type UsernameCheck = 'idle' | 'checking' | 'free' | 'taken' | 'unknown';

/** Said under the field when the name belongs to someone else. */
export const USERNAME_TAKEN = 'That username is taken. Try another.';

/**
 * Asks, a moment after typing stops, whether a username is already someone's.
 * `base` is the origin hosting the directory (empty in the web app). `mine` is
 * the asking account's own address, when it has one.
 */
export function useUsernameCheck(base: string, username: string, mine?: string): UsernameCheck {
  const [answer, setAnswer] = useState<{ username: string; check: UsernameCheck } | null>(null);
  const valid = validateUsername(username) === null;

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const timer = setTimeout(() => {
      void lookupUsername(base, username).then((result) => {
        if (!live) return;
        const someoneElse =
          result.state === 'taken' && result.identity.address.toLowerCase() !== mine?.toLowerCase();
        setAnswer({ username, check: result.state === 'unknown' ? 'unknown' : someoneElse ? 'taken' : 'free' });
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [base, username, mine, valid]);

  if (!valid) return 'idle';
  return answer?.username === username ? answer.check : 'checking';
}
