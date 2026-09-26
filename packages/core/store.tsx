import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { viewAllowance, viewSeat, type AllowanceView, type SeatView } from './allowance';
import { DEMO_RATE, type Rate } from './fx';
import {
  demoGateway,
  type AllowanceDraft,
  type InvoiceDraft,
  type PaymentsGateway,
  type ProcurementRequestDraft,
  type SeatDraft,
  type SendInput,
  type SendQuote,
  type StockQuote,
  type StockSearchResult,
} from './gateway';
import { kobo, type Naira } from './money';
import { oneOffContact } from './one-off';
import type {
  Activity,
  Contact,
  GrowPosition,
  Invoice,
  ProcurementRequest,
  Proposal,
  Receipt,
  Snapshot,
  StockPosition,
  TaxReserve,
} from './schemas';

type Status = 'loading' | 'ready' | 'failed';

type Store = {
  status: Status;
  balance: Naira;
  rate: Rate;
  paused: boolean;
  contacts: Contact[];
  allowances: AllowanceView[];
  activity: Activity[];
  seats: SeatView[];
  invoices: Invoice[];
  procurementRequests: ProcurementRequest[];
  taxReserves: TaxReserve[];
  growPosition: GrowPosition | null;
  stockPositions: StockPosition[];
  /** False until a broker is configured — the Stocks screen shows its
   * "not available yet" state from this, not from a failed call. */
  stocksAvailable: boolean;
  proposal: Proposal | null;
  request: Snapshot['request'] | null;
  contact(id: string): Contact | undefined;
  allowance(id: string): AllowanceView | undefined;
  seat(id: string): SeatView | undefined;
  invoice(id: string): Invoice | undefined;
  setPaused(next: boolean): Promise<void>;
  /** The real fee and total for a send, asked before anything is signed. */
  quoteSend(amountMinor: number): Promise<SendQuote>;
  /** Re-reads the balance, allowances and activity — after money is added, or
   * when the person pulls to refresh. Keeps what is on screen while it loads. */
  refresh(): Promise<void>;
  send(input: SendInput): Promise<Receipt>;
  saveAllowance(draft: AllowanceDraft): Promise<void>;
  revokeAllowance(id: string): Promise<void>;
  cancelProposal(): Promise<void>;
  runProposal(): Promise<Receipt>;
  receipt(id: string): Receipt | undefined;
  saveSeat(draft: SeatDraft): Promise<void>;
  revokeSeat(id: string): Promise<void>;
  createInvoice(draft: InvoiceDraft): Promise<Invoice>;
  settleInvoice(invoiceId: string, taxFraction?: number): Promise<void>;
  createProcurementRequest(draft: ProcurementRequestDraft): Promise<ProcurementRequest>;
  /** Re-checks a `'pending-release'` invoice's condition against `rate`.
   * Resolves `true` if it released, `false` if it's still not met. */
  requestConditionalRelease(invoiceId: string, rate: Rate): Promise<boolean>;
  depositGrow(amountMinor: number): Promise<void>;
  withdrawGrow(amountMinor: number): Promise<void>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
  getStockQuote(symbol: string): Promise<StockQuote>;
  /** Quantities are fixed-point, 4 decimal places — see `stockPositionSchema`. */
  buyStock(symbol: string, quantityScaled: number): Promise<void>;
  sellStock(symbol: string, quantityScaled: number): Promise<void>;
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
  const [quotedAt, setQuotedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    let live = true;
    gateway
      .loadSnapshot()
      .then((next) => {
        if (!live) return;
        setSnapshot(next);
        setQuotedAt(new Date().toISOString());
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

  const refresh = useCallback(async () => {
    const next = await gateway.loadSnapshot();
    setSnapshot(next);
    setQuotedAt(new Date().toISOString());
    setProposal(next.proposal);
    // A re-read that succeeds after a failed first load is what "Retry" means:
    // without this the store stayed 'failed' with a good snapshot behind it.
    setStatus('ready');
  }, [gateway]);

  const quoteSend = useCallback((amountMinor: number) => gateway.quoteSend(amountMinor), [gateway]);

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
      // The subtraction above is a same-tick estimate so the screen never sits
      // on stale pre-send numbers; this replaces it with the real read as soon
      // as it lands, so a fee or balance edge case never leaves the estimate
      // wrong until the next manual pull-to-refresh.
      void refresh().catch(() => undefined);
      return settledReceipt;
    },
    [gateway, refresh],
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

  const saveSeat = useCallback(
    async (draft: SeatDraft) => {
      const saved = await gateway.saveSeat(draft);
      setSnapshot((current) => {
        if (!current) return current;
        const exists = current.seats.some((s) => s.id === saved.id);
        return {
          ...current,
          seats: exists
            ? current.seats.map((s) => (s.id === saved.id ? { ...saved, spentMinor: s.spentMinor } : s))
            : [...current.seats, saved],
        };
      });
    },
    [gateway],
  );

  const revokeSeat = useCallback(
    async (id: string) => {
      await gateway.revokeSeat(id);
      setSnapshot((current) => (current ? { ...current, seats: current.seats.filter((s) => s.id !== id) } : current));
    },
    [gateway],
  );

  const createInvoice = useCallback(
    async (draft: InvoiceDraft) => {
      const invoice = await gateway.createInvoice(draft);
      setSnapshot((current) => (current ? { ...current, invoices: [invoice, ...current.invoices] } : current));
      return invoice;
    },
    [gateway],
  );

  const settleInvoice = useCallback(
    async (invoiceId: string, taxFraction = 0.2) => {
      const { invoice, taxReserve } = await gateway.settleInvoice(invoiceId, taxFraction);
      setSnapshot((current) => {
        if (!current) return current;
        return {
          ...current,
          invoices: current.invoices.map((entry) => (entry.id === invoiceId ? invoice : entry)),
          // The real gateway keeps no reserve, so there may be none to add.
          taxReserves: taxReserve ? [taxReserve, ...current.taxReserves] : current.taxReserves,
        };
      });
    },
    [gateway],
  );

  const createProcurementRequest = useCallback(
    async (draft: ProcurementRequestDraft) => {
      const request = await gateway.createProcurementRequest(draft);
      setSnapshot((current) =>
        current ? { ...current, procurementRequests: [request, ...current.procurementRequests] } : current,
      );
      return request;
    },
    [gateway],
  );

  const requestConditionalRelease = useCallback(
    async (invoiceId: string, rate: Rate) => {
      const result = await gateway.requestConditionalRelease(invoiceId, rate);
      if (!result) return false;
      const { invoice, taxReserve } = result;
      setSnapshot((current) => {
        if (!current) return current;
        return {
          ...current,
          invoices: current.invoices.map((entry) => (entry.id === invoiceId ? invoice : entry)),
          taxReserves: [taxReserve, ...current.taxReserves],
        };
      });
      return true;
    },
    [gateway],
  );

  const depositGrow = useCallback(
    async (amountMinor: number) => {
      const growPosition = await gateway.depositGrow(amountMinor);
      setSnapshot((current) => (current ? { ...current, growPosition } : current));
    },
    [gateway],
  );

  const withdrawGrow = useCallback(
    async (amountMinor: number) => {
      const growPosition = await gateway.withdrawGrow(amountMinor);
      setSnapshot((current) => (current ? { ...current, growPosition } : current));
    },
    [gateway],
  );

  const searchStocks = useCallback((query: string) => gateway.searchStocks(query), [gateway]);
  const getStockQuote = useCallback((symbol: string) => gateway.getStockQuote(symbol), [gateway]);

  const buyStock = useCallback(
    async (symbol: string, quantityScaled: number) => {
      const stockPositions = await gateway.buyStock(symbol, quantityScaled);
      setSnapshot((current) => (current ? { ...current, stockPositions } : current));
    },
    [gateway],
  );

  const sellStock = useCallback(
    async (symbol: string, quantityScaled: number) => {
      const stockPositions = await gateway.sellStock(symbol, quantityScaled);
      setSnapshot((current) => (current ? { ...current, stockPositions } : current));
    },
    [gateway],
  );

  const runProposal = useCallback(async () => {
    if (!proposal) throw new Error('No assistant payment is waiting');
    const settledReceipt = await send({
      contactId: proposal.contactId,
      amountMinor: proposal.amountMinor,
      note: proposal.note,
      allowanceId: proposal.allowanceId,
    });
    // The proposal is consumed: drop the server inbox copy through the same
    // clear path a cancel uses, so it does not re-surface on the next refresh.
    await gateway.cancelProposal(proposal.id);
    setProposal(null);
    return settledReceipt;
  }, [gateway, proposal, send]);

  const value = useMemo<Store>(() => {
    const contacts = snapshot?.contacts ?? [];
    const allowances = (snapshot?.allowances ?? []).map(viewAllowance);
    const seats = (snapshot?.seats ?? []).map(viewSeat);
    const invoices = snapshot?.invoices ?? [];
    const procurementRequests = snapshot?.procurementRequests ?? [];
    const taxReserves = snapshot?.taxReserves ?? [];

    return {
      status,
      balance: kobo(snapshot?.account.balanceMinor ?? 0),
      // Until a snapshot arrives screens show skeletons, not numbers, so this
      // placeholder is never rendered as a real rate.
      rate: snapshot ? { koboPerDollar: snapshot.account.koboPerDollar, quotedAt } : DEMO_RATE,
      paused: snapshot?.account.paused ?? false,
      contacts,
      allowances,
      activity: snapshot?.activity ?? [],
      seats,
      invoices,
      procurementRequests,
      taxReserves,
      growPosition: snapshot?.growPosition ?? null,
      stockPositions: snapshot?.stockPositions ?? [],
      stocksAvailable: gateway.stocksAvailable,
      proposal,
      request: snapshot?.request ?? null,
      // A one-off payment code has no saved record; it is named by its code.
      contact: (id) => contacts.find((c) => c.id === id) ?? oneOffContact(id),
      allowance: (id) => allowances.find((a) => a.id === id),
      seat: (id) => seats.find((s) => s.id === id),
      invoice: (id) => invoices.find((i) => i.id === id),
      setPaused,
      quoteSend,
      refresh,
      send,
      saveAllowance,
      revokeAllowance,
      cancelProposal,
      runProposal,
      receipt: (id) => receipts[id],
      saveSeat,
      revokeSeat,
      createInvoice,
      settleInvoice,
      createProcurementRequest,
      requestConditionalRelease,
      depositGrow,
      withdrawGrow,
      searchStocks,
      getStockQuote,
      buyStock,
      sellStock,
    };
  }, [
    buyStock,
    cancelProposal,
    createInvoice,
    createProcurementRequest,
    depositGrow,
    gateway,
    getStockQuote,
    proposal,
    quoteSend,
    quotedAt,
    receipts,
    refresh,
    requestConditionalRelease,
    revokeAllowance,
    revokeSeat,
    runProposal,
    saveAllowance,
    saveSeat,
    searchStocks,
    sellStock,
    send,
    setPaused,
    settleInvoice,
    snapshot,
    status,
    withdrawGrow,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
