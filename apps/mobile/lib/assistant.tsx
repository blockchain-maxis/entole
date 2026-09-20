import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AssistantNotEnabledError } from '@entole/core/onchain-gateway';
import type { EntoleKeyAccount } from '@entole/core/passkey';

import { useAccount } from './account';
import {
  clearAssistant,
  deriveAssistantAccount,
  isAssistantEnabled,
  loadAssistantAddress,
  markAssistantEnabled,
} from './session';

type EnableResult = { ok: true } | { ok: false; reason: string };

type AssistantValue = {
  /** True until the saved on/off choice has been read. */
  loading: boolean;
  /** Off until the person approves it. Never on by default. */
  enabled: boolean;
  /** The assistant key's address (never shown) — lets an allowance be created
   * without a passkey prompt. */
  address: `0x${string}` | null;
  /** Approves the assistant: derives its key from the passkey (one prompt),
   * remembers the choice, and holds the key in memory. */
  enable: () => Promise<EnableResult>;
  /** Turns it off and drops the key. */
  disable: () => Promise<void>;
  /** The assistant's key when something needs to act. In memory already →
   * returned at once; enabled but not yet loaded after a restart → derived now
   * (one prompt), once, and shared by every caller waiting on it. */
  ensureKey: () => Promise<EntoleKeyAccount>;
};

const AssistantContext = createContext<AssistantValue | null>(null);

/**
 * The assistant is a setting the person turns on, not a default. Signing in
 * derives only their own key (one prompt); the assistant's key — a second
 * passkey ceremony with its own salt — is derived here, only when they approve
 * the assistant, and after a restart only when it first has something to do.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { account, setAssistantKey } = useAccount();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);

  const accountRef = useRef(account);
  const enabledRef = useRef(enabled);
  const inFlight = useRef<Promise<EntoleKeyAccount> | null>(null);
  useEffect(() => {
    accountRef.current = account;
    enabledRef.current = enabled;
  }, [account, enabled]);

  // Re-read the saved choice whenever a different account signs in, so a
  // "sign out everywhere" followed by a fresh sign-up never inherits the last
  // person's setting.
  const owner = account?.owner ?? null;
  useEffect(() => {
    let live = true;
    Promise.all([isAssistantEnabled(), loadAssistantAddress()])
      .then(([on, saved]) => {
        if (!live) return;
        setEnabled(on && saved !== null);
        setAddress(saved);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [owner]);

  const enable = useCallback(async (): Promise<EnableResult> => {
    const current = accountRef.current;
    if (!current) return { ok: false, reason: 'Sign in first.' };
    const result = await deriveAssistantAccount(current.owner);
    if (!result.ok) return result;
    await markAssistantEnabled(result.session.address);
    setAssistantKey(result.session);
    setAddress(result.session.address);
    setEnabled(true);
    return { ok: true };
  }, [setAssistantKey]);

  const disable = useCallback(async () => {
    await clearAssistant();
    setAssistantKey(null);
    setAddress(null);
    setEnabled(false);
  }, [setAssistantKey]);

  const ensureKey = useCallback(async (): Promise<EntoleKeyAccount> => {
    const current = accountRef.current;
    if (!current) throw new Error('Sign in first.');
    if (current.session) return current.session;
    if (!enabledRef.current) throw new AssistantNotEnabledError();

    inFlight.current ??= (async () => {
      const result = await deriveAssistantAccount(current.owner);
      if (!result.ok) throw new Error(result.reason);
      setAssistantKey(result.session);
      return result.session;
    })().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [setAssistantKey]);

  const value = useMemo<AssistantValue>(
    () => ({ loading, enabled, address, enable, disable, ensureKey }),
    [loading, enabled, address, enable, disable, ensureKey],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantValue {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('useAssistant must be used inside AssistantProvider');
  return context;
}
