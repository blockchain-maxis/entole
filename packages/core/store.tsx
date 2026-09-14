import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { viewAllowance, type AllowanceView } from './allowance';
import { DEMO_RATE, type Rate } from './fx';
import { demoGateway, type AllowanceDraft, type PaymentsGateway, type SendInput } from './gateway';
import { kobo, type Naira } from './money';
import type { Activity, Contact, Pot, Proposal, Receipt, Snapshot } from './schemas';

type Status = 'loading' | 'ready' | 'failed';

type Store = {
  status: Status;
  balance: Naira;
  rate: Rate;
  paused: boolean;
  contacts: Contact[];
  allowances: AllowanceView[];
  activity: Activity[];
  pots: Pot[];
  proposal: Proposal | null;
  request: Snapshot['request'] | null;
  contact(id: string): Contact | undefined;
  allowance(id: string): AllowanceView | undefined;
  pot(id: string): Pot | undefined;
  setPaused(next: boolean): Promise<void>;
  send(input: SendInput): Promise<Receipt>;
  saveAllowance(draft: AllowanceDraft): Promise<void>;
  revokeAllowance(id: string): Promise<void>;
  cancelProposal(): Promise<void>;
  runProposal(): Promise<Receipt>;
  receipt(id: string): Receipt | undefined;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({
  children,
  gateway = demoGateway,
}: {
  children: React.ReactNode;
  gateway?: PaymentsGateway;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);

  useEffect(() => {
    let live = true;
    gateway
      .loadSnapshot()
      .then((next) => {
        if (!live) return;
        setSnapshot(next);
        setProposal(next.proposal);
        setStatus('ready');
      })
      .catch(() => {
        if (live) setStatus('failed');
      });
    return () => {
      live = false;
    };
  }, [gateway]);

  const setPaused = useCallback(
    async (next: boolean) => {
      await gateway.setPaused(next);
      setSnapshot((current) =>
        current ? { ...current, account: { ...current.account, paused: next } } : current,
      );
    },
    [gateway],
  );

  const send = useCallback(
    async (input: SendInput) => {
      // Resolves only once settled — there is no interim optimistic entry.
      const settledReceipt = await gateway.submitPayment(input);
      setReceipts((current) => ({ ...current, [settledReceipt.id]: settledReceipt }));
      setSnapshot((current) => {
        if (!current) return current;
        const entry: Activity = {
          id: settledReceipt.id,
          contactId: input.contactId,
          note: input.note ?? 'Sent',
          at: settledReceipt.settledAt,
          amountMinor: input.amountMinor,
          direction: 'out',
          initiatedBy: input.allowanceId ? 'assistant' : 'you',
          state: 'settled',
          ...(input.allowanceId ? { allowanceId: input.allowanceId } : {}),
        };
        return {
          ...current,
          account: {
            ...current.account,
            balanceMinor: Math.max(
              0,
              current.account.balanceMinor - input.amountMinor - settledReceipt.feeMinor,
            ),
          },
          activity: [entry, ...current.activity],
          allowances: current.allowances.map((allowance) =>
            allowance.id === input.allowanceId
              ? { ...allowance, spentMinor: allowance.spentMinor + input.amountMinor }
              : allowance,
          ),
        };
      });
      return settledReceipt;
    },
    [gateway],
  );

  const saveAllowance = useCallback(
    async (draft: AllowanceDraft) => {
      const saved = await gateway.saveAllowance(draft);
      setSnapshot((current) => {
        if (!current) return current;
        const exists = current.allowances.some((a) => a.id === saved.id);
        return {
          ...current,
          allowances: exists
            ? current.allowances.map((a) =>
                a.id === saved.id ? { ...saved, spentMinor: a.spentMinor } : a,
              )
            : [...current.allowances, saved],
        };
      });
    },
    [gateway],
  );

  const revokeAllowance = useCallback(
    async (id: string) => {
      await gateway.revokeAllowance(id);
      setSnapshot((current) =>
        current ? { ...current, allowances: current.allowances.filter((a) => a.id !== id) } : current,
      );
    },
    [gateway],
  );

  const cancelProposal = useCallback(async () => {
    if (!proposal) return;
    await gateway.cancelProposal(proposal.id);
    setProposal(null);
  }, [gateway, proposal]);

  const runProposal = useCallback(async () => {
    if (!proposal) throw new Error('No assistant payment is waiting');
    const settledReceipt = await send({
      contactId: proposal.contactId,
      amountMinor: proposal.amountMinor,
      note: proposal.note,
      allowanceId: proposal.allowanceId,
    });
    setProposal(null);
    return settledReceipt;
  }, [proposal, send]);

  const value = useMemo<Store>(() => {
    const contacts = snapshot?.contacts ?? [];
    const allowances = (snapshot?.allowances ?? []).map(viewAllowance);
    const pots = snapshot?.pots ?? [];

    return {
      status,
      balance: kobo(snapshot?.account.balanceMinor ?? 0),
      rate: snapshot
        ? { koboPerDollar: snapshot.account.koboPerDollar, quotedAt: DEMO_RATE.quotedAt }
        : DEMO_RATE,
      paused: snapshot?.account.paused ?? false,
      contacts,
      allowances,
      activity: snapshot?.activity ?? [],
      pots,
      proposal,
      request: snapshot?.request ?? null,
      contact: (id) => contacts.find((c) => c.id === id),
      allowance: (id) => allowances.find((a) => a.id === id),
      pot: (id) => pots.find((p) => p.id === id),
      setPaused,
      send,
      saveAllowance,
      revokeAllowance,
      cancelProposal,
      runProposal,
      receipt: (id) => receipts[id],
    };
  }, [
    cancelProposal,
    proposal,
    receipts,
    revokeAllowance,
    runProposal,
    saveAllowance,
    send,
    setPaused,
    snapshot,
    status,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
