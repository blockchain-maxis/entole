'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { EntoleKeyAccount } from '@entole/core/passkey';

/** The owner key and its session (delegate) key, derived from the same
 * passkey at sign-in — see `@entole/core/passkey`. Both are needed to
 * construct the real on-chain gateway (owner signs direct sends and
 * allowance management, the session key signs allowance-gated executes). */
export type SignedInAccount = { owner: EntoleKeyAccount; session: EntoleKeyAccount; displayName: string };

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
   * so there is never a live key left behind by accident. */
  setAccount: (next: SignedInAccount | null) => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccountState] = useState<SignedInAccount | null>(null);

  const setAccount = useCallback((next: SignedInAccount | null) => {
    setAccountState((current) => {
      if (current && current !== next) {
        current.owner.end();
        current.session.end();
      }
      return next;
    });
  }, []);

  const value = useMemo<AccountContextValue>(() => ({ account, setAccount }), [account, setAccount]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccount must be used inside AccountProvider');
  return context;
}
