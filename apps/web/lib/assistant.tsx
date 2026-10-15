'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AssistantNotEnabledError } from '@entole/core/onchain-gateway';
import type { EntoleKeyAccount } from '@entole/core/passkey';

import { useAccount } from './account';
import {
  clearAssistant,
  deriveAssistantAccount,
  isAssistantEnabled,
  isTalkOn,
  loadAssistantAddress,
  markAssistantEnabled,
  saveTalkOn,
} from './session';

type EnableResult = { ok: true } | { ok: false; reason: string };

type AssistantValue = {
  /** True until the saved on/off choice has been read. */
  loading: boolean;
  /** Whether the person talks to it. No key and no passkey: it only opens screens and gets things ready. */
  talking: boolean;
  startTalking: () => void;
  stopTalking: () => void;
  /** Whether it can pay inside allowances: it holds its own key. Off until the
   * person writes it an allowance or turns it on. Never on by default. */
  enabled: boolean;
  /** The assistant key's address (never shown) — lets an allowance be created
   * without a passkey prompt. */
  address: `0x${string}` | null;
  /** Approves the assistant: derives its key from the passkey (one prompt),
   * remembers the choice, and holds the key in memory. */
  enable: () => Promise<EnableResult>;
  /** Turns it off and drops the key. */
  disable: () => void;
  /** The assistant's key when something needs to act. In memory already →
   * returned at once; enabled but not yet loaded after a reload → derived now
   * (one prompt), once, shared by every caller waiting on it. */
  ensureKey: () => Promise<EntoleKeyAccount>;
};

const AssistantContext = createContext<AssistantValue | null>(null);

/**
 * The assistant is two settings the person turns on, never defaults.
 *
 * Talking to it costs nothing: no key, no passkey. It only reads what was said
 * and works the app, and everything that moves money still ends at the
 * person's own confirmation.
 *
 * Paying inside allowances needs its own key — a second passkey ceremony with
 * its own salt — derived here only when they turn that on (or write their
 * first allowance), and after a reload only when it first has something to
 * do. Signing in derives only their own key (one prompt). Mirrors
 * `apps/mobile/lib/assistant.tsx`.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { account, setAssistantKey } = useAccount();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [talking, setTalking] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);

  const accountRef = useRef(account);
  const enabledRef = useRef(enabled);
  const inFlight = useRef<Promise<EntoleKeyAccount> | null>(null);
  useEffect(() => {
    accountRef.current = account;
    enabledRef.current = enabled;
  }, [account, enabled]);

  // Re-read the saved choice whenever a different account signs in.
  const owner = account?.owner ?? null;
  useEffect(() => {
    function readSavedChoice() {
      const saved = loadAssistantAddress();
      setEnabled(isAssistantEnabled() && saved !== null);
      setTalking(isTalkOn());
      setAddress(saved);
      setLoading(false);
    }
    readSavedChoice();
  }, [owner]);

  const enable = useCallback(async (): Promise<EnableResult> => {
    const current = accountRef.current;
    if (!current) return { ok: false, reason: 'Sign in first.' };
    const result = await deriveAssistantAccount(current.owner);
    if (!result.ok) return result;
    markAssistantEnabled(result.session.address);
    setAssistantKey(result.session);
    setAddress(result.session.address);
    setEnabled(true);
    return { ok: true };
  }, [setAssistantKey]);

  const startTalking = useCallback(() => {
    saveTalkOn(true);
    setTalking(true);
  }, []);

  const stopTalking = useCallback(() => {
    saveTalkOn(false);
    setTalking(false);
  }, []);

  const disable = useCallback(() => {
    clearAssistant();
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
    () => ({ loading, talking, startTalking, stopTalking, enabled, address, enable, disable, ensureKey }),
    [loading, talking, startTalking, stopTalking, enabled, address, enable, disable, ensureKey],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantValue {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('useAssistant must be used inside AssistantProvider');
  return context;
}
