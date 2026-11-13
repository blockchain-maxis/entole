import { useCallback, useEffect, useMemo, useState } from 'react';

import { useBackend } from './backend';
import { activityToLines, buildMoneyPicture, DEFAULT_PICTURE_SETTINGS, type MoneyPicture } from './money-picture';
import type { StatementRead } from './records';
import type { StatementLine } from './statement';
import type { StatementReading } from './near-client';
import { useStore } from './store';

/**
 * The money picture for the signed-in person, shared by both apps.
 *
 * Built on the device from the person's own lines: the statements they have
 * read (kept sealed on the device) and their Entole activity. The balance it
 * reasons from is the bank's closing balance on the latest statement plus the
 * Entole balance, and the screen says which date that bank figure is from.
 */

export type MoneyPictureState = {
  status: 'loading' | 'empty' | 'ready';
  picture: MoneyPicture | null;
  /** The latest reading: how fresh the bank side is, whether it balanced and was proven. */
  latest: StatementRead | null;
  /** Reads and keeps a statement. Resolves with the reading so the screen can show its proof. */
  importStatement: (pdf: Uint8Array, password?: string) => Promise<StatementReading>;
  forget: () => Promise<void>;
};

const today = () => new Date().toISOString().slice(0, 10);

export function useMoneyPicture(): MoneyPictureState {
  const backend = useBackend();
  const store = useStore();
  const [lines, setLines] = useState<StatementLine[] | null>(null);
  const [reads, setReads] = useState<StatementRead[]>([]);

  const reload = useCallback(async () => {
    const [kept, history] = await Promise.all([backend.statement.lines(), backend.statement.reads()]);
    setLines(kept);
    setReads(history);
  }, [backend]);

  useEffect(() => {
    let alive = true;
    Promise.all([backend.statement.lines(), backend.statement.reads()]).then(
      ([kept, history]) => {
        if (!alive) return;
        setLines(kept);
        setReads(history);
      },
      () => {
        if (alive) setLines([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [backend]);

  const latest = reads[0] ?? null;
  const picture = useMemo(() => {
    if (lines === null) return null;
    const entole = activityToLines(store.activity, (id) => store.contacts.find((contact) => contact.id === id)?.name ?? 'Entole');
    const all = [...lines, ...entole];
    if (!all.length) return null;
    const bank = latest?.closingMinor;
    const balanceMinor = store.status === 'ready' ? store.balance + (bank ?? 0) : bank ?? null;
    return buildMoneyPicture({ lines: all, balanceMinor, today: today(), settings: DEFAULT_PICTURE_SETTINGS });
  }, [lines, latest, store.activity, store.contacts, store.balance, store.status]);

  const importStatement = useCallback(async (pdf: Uint8Array, password?: string) => {
    const reading = await backend.near.readStatement(pdf, password);
    const from = reading.lines[0]?.date ?? today();
    const to = reading.lines.at(-1)?.date ?? today();
    await backend.statement.add(reading.lines, {
      at: new Date().toISOString(),
      from,
      to,
      lines: reading.lines.length,
      status: reading.reconciliation.status,
      ...(reading.reconciliation.differenceMinor !== undefined ? { differenceMinor: reading.reconciliation.differenceMinor } : {}),
      ...(reading.reconciliation.closingMinor !== undefined ? { closingMinor: reading.reconciliation.closingMinor } : {}),
      proven: reading.proof.proven,
      model: reading.proof.model,
    }, today());
    await reload();
    return reading;
  }, [backend, reload]);

  const forget = useCallback(async () => {
    await backend.statement.clear();
    await reload();
  }, [backend, reload]);

  return {
    status: lines === null ? 'loading' : picture ? 'ready' : 'empty',
    picture,
    latest,
    importStatement,
    forget,
  };
}

/**
 * The same picture, read once, outside a component: for the assistant, which
 * builds its facts at the moment it answers. Null until a statement is read.
 */
export async function readMoneyPicture(
  backend: Pick<ReturnType<typeof useBackend>, 'statement'>,
  store: Pick<ReturnType<typeof useStore>, 'activity' | 'contacts' | 'balance' | 'status'>,
): Promise<MoneyPicture | null> {
  return (await readMoneyView(backend, store)).picture;
}

/**
 * The picture and the lines it was built from (statements and Entole
 * activity together), for the check-in and the nudges. With no statement
 * read, the lines are Entole's own and there is no picture.
 */
export async function readMoneyView(
  backend: Pick<ReturnType<typeof useBackend>, 'statement'>,
  store: Pick<ReturnType<typeof useStore>, 'activity' | 'contacts' | 'balance' | 'status'>,
): Promise<{ picture: MoneyPicture | null; lines: StatementLine[] }> {
  const [lines, reads] = await Promise.all([backend.statement.lines(), backend.statement.reads()]);
  const entole = activityToLines(store.activity, (id) => store.contacts.find((contact) => contact.id === id)?.name ?? 'Entole');
  const all = [...lines, ...entole];
  if (!lines.length) return { picture: null, lines: all };
  const bank = reads[0]?.closingMinor;
  const balanceMinor = store.status === 'ready' ? store.balance + (bank ?? 0) : bank ?? null;
  return { picture: buildMoneyPicture({ lines: all, balanceMinor, today: today(), settings: DEFAULT_PICTURE_SETTINGS }), lines: all };
}
