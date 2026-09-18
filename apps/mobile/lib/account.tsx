import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { EntoleKeyAccount } from '@entole/core/passkey';

/**
 * The live signing session for whoever is currently signed in — in memory
 * only, for exactly as long as the app is open. Nothing here is written to
 * disk; `lib/session.ts` persists only the passkey's credential id, never
 * key material. Re-deriving the account is the sign-in flow, not a fallback
 * for a store that could have kept it.
 */
type AccountContextValue = {
  account: EntoleKeyAccount | null;
  /** Replacing the account ends the previous one's signing session first,
   * so there is never a live key left behind by accident. */
  setAccount: (next: EntoleKeyAccount | null) => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccountState] = useState<EntoleKeyAccount | null>(null);

  const setAccount = useCallback((next: EntoleKeyAccount | null) => {
    setAccountState((current) => {
      if (current && current !== next) current.end();
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
