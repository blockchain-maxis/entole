import { useCallback, useEffect, useMemo, useState } from 'react';

import { nudgesFrom, type AssistantFacts } from './assistant-actions';
import { changeMemory, type MemoryEntry } from './ayo-memory';
import type { Nudge } from './ayo-nudges';
import { lagosToday } from './ayo-voice';
import { useBackend } from './backend';
import { readMoneyView } from './money-picture-hook';
import { useStore } from './store';

/**
 * Ayo's nudges for the signed-in person, shared by both apps: the card on
 * Home and the line Ayo opens with. Everything is read and worked out on the
 * device (`ayo-nudges.ts`); nothing here asks a model.
 */

export type AyoNudgesState = {
  status: 'loading' | 'ready';
  nudges: Nudge[];
  /** The one worth saying first, or null. */
  top: Nudge | null;
  /** "Not now": kept in what Ayo remembers, so it does not come back. */
  dismiss: (id: string) => Promise<void>;
  reload: () => void;
};

/** The facts every nudge needs, read once. Exported so Ayo can greet with them without a component. */
export async function readNudgeFacts(
  backend: ReturnType<typeof useBackend>,
  store: ReturnType<typeof useStore>,
): Promise<{ facts: AssistantFacts; memory: MemoryEntry[] | null }> {
  const [view, memory] = await Promise.all([
    readMoneyView(backend, store).catch(() => ({ picture: null, lines: [] })),
    backend.memory.list().catch(() => null),
  ]);
  return {
    memory,
    facts: {
      balanceMinor: store.balance,
      activity: store.activity,
      allowances: store.allowances,
      savingsMinor: store.growPosition?.balanceMinor ?? null,
      username: null,
      contactName: (id) => store.contact(id)?.name,
      picture: view.picture,
      lines: view.lines,
      invoices: store.invoices,
      memory,
    },
  };
}

export function useAyoNudges(): AyoNudgesState {
  const backend = useBackend();
  const store = useStore();
  const [nudges, setNudges] = useState<Nudge[] | null>(null);
  const [version, setVersion] = useState(0);
  const ready = store.status === 'ready';

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    readNudgeFacts(backend, store).then(
      ({ facts }) => {
        if (alive) setNudges(nudgesFrom(facts));
      },
      () => {
        if (alive) setNudges([]);
      },
    );
    return () => {
      alive = false;
    };
    // The store object changes with every refresh; what the nudges read from is listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, ready, store.balance, store.activity, store.invoices, store.growPosition, version]);

  const dismiss = useCallback(
    async (id: string) => {
      setNudges((current) => (current ? current.filter((nudge) => nudge.id !== id) : current));
      const memory = await backend.memory.list().catch(() => null);
      if (!memory) return;
      const now = new Date();
      const outcome = changeMemory(memory, { kind: 'dismiss', id }, { now, today: lagosToday(now), savingsMinor: null });
      if (outcome.ok) await backend.memory.write(outcome.entries).catch(() => undefined);
    },
    [backend],
  );

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  return useMemo(
    () => ({ status: nudges === null ? 'loading' : 'ready', nudges: nudges ?? [], top: nudges?.[0] ?? null, dismiss, reload }),
    [nudges, dismiss, reload],
  );
}
