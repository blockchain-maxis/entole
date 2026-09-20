'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { EntoleKeyAccount } from '@entole/core/passkey';

/** The owner key, derived from the passkey at sign-in, and — only once the
 * person has approved the assistant — the assistant's (session/delegate) key,
 * derived from the same passkey with its own PRF salt. See
 * `@entole/core/passkey`. The owner signs direct sends and allowance
 * management; the session key signs allowance-gated executes. `session` is
 * `null` until the assistant is turned on. */
export type SignedInAccount = {
  owner: EntoleKeyAccount;
  session: EntoleKeyAccount | null;
  /** The person's full name — what the greeting and the profile chip show. */
  displayName: string;
  /** Their chosen handle, lowercase, no "@". Format-checked only; see
   * `@entole/core/profile` for why uniqueness is not. */
  username: string;
};

/**
 * The live signing session for whoever is currently signed in — in memory
 * only, for exactly as long as the tab is open. Nothing here is written to
 * disk; `lib/session.ts` persists only the passkey's credential id, never
 * key material. Re-deriving the account is the sign-in flow, not a fallback
 * for a store that could have kept it.
 */
type AccountContextValue = {
  account: SignedInAccount | null;
  /** Replacing the account ends the previous one's signing sessions first,
   * so there is never a live key left behind by accident — but only keys
   * that are actually being replaced: merging a field into the same account
   * keeps its keys alive. */
  setAccount: (next: SignedInAccount | null) => void;
  /** Sets (or, with `null`, drops and ends) just the assistant's key, leaving
   * the owner key untouched. */
  setAssistantKey: (next: EntoleKeyAccount | null) => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccountState] = useState<SignedInAccount | null>(null);

  const setAccount = useCallback((next: SignedInAccount | null) => {
    setAccountState((current) => {
      if (current) {
        if (current.owner !== next?.owner) current.owner.end();
        if (current.session && current.session !== next?.session) current.session.end();
      }
      return next;
    });
  }, []);

  const setAssistantKey = useCallback((next: EntoleKeyAccount | null) => {
    setAccountState((current) => {
      if (!current) {
        next?.end();
        return current;
      }
      if (current.session && current.session !== next) current.session.end();
      return { ...current, session: next };
    });
  }, []);

  const value = useMemo<AccountContextValue>(
    () => ({ account, setAccount, setAssistantKey }),
    [account, setAccount, setAssistantKey],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccount must be used inside AccountProvider');
  return context;
}
