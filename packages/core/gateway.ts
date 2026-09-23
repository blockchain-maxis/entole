import { evaluateReleaseCondition } from './chainlink-cre';
import { SNAPSHOT } from './fixtures';
import type { Rate } from './fx';
import { applyStockTrade } from './stock-broker';
import {
  growPositionSchema,
  invoiceSchema,
  procurementRequestSchema,
  receiptSchema,
  seatSchema,
  snapshotSchema,
  taxReserveSchema,
  type Allowance,
  type Cadence,
  type GrowPosition,
  type Invoice,
  type ProcurementItem,
  type ProcurementRequest,
  type Receipt,
  type ReleaseCondition,
  type Seat,
  type SeatRole,
  type Snapshot,
  type StockPosition,
  type TaxReserve,
} from './schemas';

/**
 * The one seam between the app and everything that settles money.
 *
 * Swapping the demo gateway for the real one is a single-file change, which is
 * what keeps the settlement asset and the off-ramp replaceable.
 *
 * `submitPayment` resolves only once a payment has actually settled. Nothing in
 * this interface lets a screen render a settled state early.
 */
export interface PaymentsGateway {
  loadSnapshot(): Promise<Snapshot>;
  /** What sending `amountMinor` will cost, asked before anything is signed —
   * the confirmation sheet shows it. Fee is whatever the settlement contract
   * will actually charge, never an estimate. */
  quoteSend(amountMinor: number): Promise<SendQuote>;
  submitPayment(input: SendInput): Promise<Receipt>;
  setPaused(paused: boolean): Promise<void>;
  saveAllowance(draft: AllowanceDraft): Promise<Allowance>;
  revokeAllowance(allowanceId: string): Promise<void>;
  cancelProposal(proposalId: string): Promise<void>;

  /** Business layer — see docs/SCOPE.md. Every one of these is a caveat
   * grant or a plain record, never a second trust model. */
  saveSeat(draft: SeatDraft): Promise<Seat>;
  revokeSeat(seatId: string): Promise<void>;
  createInvoice(draft: InvoiceDraft): Promise<Invoice>;
  /** Marks an invoice paid. The demo gateway also splits `taxFraction` of it
   * into a tax reserve; the real one keeps no such balance, so `taxReserve` is
   * `null` there — a reserve is never invented. */
  settleInvoice(
    invoiceId: string,
    taxFraction: number,
  ): Promise<{ invoice: Invoice; taxReserve: TaxReserve | null }>;
  /** The Chainlink CRE bounty's callback target — see
   * `packages/core/chainlink-cre.ts`. Re-evaluates the invoice's own
   * `releaseCondition` against `observedRate` itself rather than trusting
   * the caller; returns `null` (invoice stays `'pending-release'`) when the
   * condition doesn't hold yet, or the same settlement `settleInvoice`
   * produces once it does. */
  requestConditionalRelease(
    invoiceId: string,
    observedRate: Rate,
  ): Promise<{ invoice: Invoice; taxReserve: TaxReserve } | null>;

  /** "Order Supplies" — a request-drafting record, not a fulfillment
   * integration. See `procurementRequestSchema`'s own doc comment. */
  createProcurementRequest(draft: ProcurementRequestDraft): Promise<ProcurementRequest>;

  /** "Grow" — the owner acting on their own deposited balance directly, no
   * delegate/allowance involved. Both resolve only once settled, same
   * promise `submitPayment` makes. */
  depositGrow(amountMinor: number): Promise<GrowPosition>;
  withdrawGrow(amountMinor: number): Promise<GrowPosition>;

  /** "Stocks" — the Grow hub's second product. `stocksAvailable` is false
   * until a broker is configured (see `packages/core/stock-broker.ts`); the
   * UI reads it to show the "not available yet" state up front instead of
   * discovering it from a failed call. Quantities are fixed-point, 4 decimal
   * places — see `stockPositionSchema`. Buy/sell resolve with the account's
   * holdings after the order, and only once the broker reports the order. */
  readonly stocksAvailable: boolean;
  searchStocks(query: string): Promise<StockSearchResult[]>;
  getStockQuote(symbol: string): Promise<StockQuote>;
  buyStock(symbol: string, quantityScaled: number): Promise<StockPosition[]>;
  sellStock(symbol: string, quantityScaled: number): Promise<StockPosition[]>;
}

/** The real cost of a send, in the account's own currency. */
export type SendQuote = {
  amountMinor: number;
  feeMinor: number;
  /** What leaves the account: amount plus fee. */
  totalMinor: number;
  /** What the recipient receives, in dollar cents. */
  receivesCents: number;
  rate: Rate;
};

export type StockSearchResult = { symbol: string; name: string };

/** A live quote in the account's own currency (kobo per share). */
export type StockQuote = { symbol: string; priceMinor: number; asOf: string };

export type SendInput = {
  contactId: string;
  amountMinor: number;
  note?: string;
  allowanceId?: string;
};

export type AllowanceDraft = {
  id?: string;
  name: string;
  recipientId: string;
  perRunMinor: number;
  limitMinor: number;
  cadence: Cadence;
};

export type SeatDraft = {
  id?: string;
  name: string;
  contactId: string;
  role: SeatRole;
  perRunMinor: number;
  limitMinor: number;
  cadence: Cadence;
};

export type InvoiceDraft = {
  clientName: string;
  amountMinor: number;
  note: string;
  dueAt: string;
  /** `INV-0001`. Numbered from the saved invoices when left out. */
  reference?: string;
  /** The checkout link the client pays through. The screen builds it — it knows
   * the payment code and the profile name — and the gateway stores it as given. */
  link?: string;
  /** Present only for a Chainlink CRE-gated invoice — see chainlink-cre.ts. */
  releaseCondition?: ReleaseCondition;
};

export type ProcurementRequestDraft = {
  supplierName: string;
  items: ProcurementItem[];
  note?: string;
};

/** Flat corridor fee, quoted before the money moves. */
export const FEE_MINOR = 25_000;

/** What we tell someone to expect. Deliberately slower than we actually are. */
export const ESTIMATED_ARRIVAL_SECONDS = 20;

const SETTLEMENT_MS = 900;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reference(): string {
  const block = () =>
    Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, '0');
  return `${block()}-${block()}-${block().slice(0, 2)}`;
}

/** Shared by `settleInvoice` and the Chainlink CRE-gated
 * `requestConditionalRelease` — both mark an invoice paid and split
 * `taxFraction` into the tax reserve the same way, the moment the money is
 * actually free to release. */
function settleInvoiceRecord(
  invoice: Invoice,
  koboPerDollar: number,
  taxFraction: number,
): { invoice: Invoice; taxReserve: TaxReserve } {
  const paidAt = new Date().toISOString();
  const reserveShare = Math.round(invoice.amountMinor * taxFraction);

  return {
    invoice: invoiceSchema.parse({ ...invoice, status: 'paid', koboPerDollar, paidAt }),
    taxReserve: taxReserveSchema.parse({
      id: `tr-${Date.now()}`,
      name: 'Q3 tax reserve',
      balanceMinor: reserveShare,
      payoutAt: '2026-10-15T00:00:00.000+01:00',
      sourceInvoiceId: invoice.id,
    }),
  };
}

/**
 * The conditional-release transition, shared between `demoGateway` and the
 * Chainlink CRE webhook route (`apps/web/app/api/chainlink-cre/release`) so
 * both apply exactly one rule. It re-checks the condition against the observed
 * rate itself; a caller's claim that the condition is met is never trusted.
 * Returns the released invoice with its tax reserve, or `null` when the
 * condition is not yet met.
 */
export function releaseConditionalInvoice(
  invoice: Invoice,
  observedRate: Rate,
  taxFraction = 0.2,
): { invoice: Invoice; taxReserve: TaxReserve } | null {
  if (!invoice.releaseCondition) {
    throw new Error(`Invoice ${invoice.id} has no release condition to evaluate`);
  }
  if (!evaluateReleaseCondition(invoice.releaseCondition, observedRate)) return null;
  return settleInvoiceRecord(invoice, observedRate.koboPerDollar, taxFraction);
}

/** Test-only catalogue for `demoGateway` — never reachable from a shipped
 * app, which builds its gateway from a real broker or shows "not available". */
const DEMO_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', priceMinor: 30_000_000 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', priceMinor: 65_000_000 },
];

function demoStock(symbol: string) {
  const stock = DEMO_STOCKS.find((s) => s.symbol === symbol.toUpperCase());
  if (!stock) throw new Error(`Unknown symbol ${symbol}`);
  return stock;
}

/**
 * Demo gateway. Timings imitate real finality, so the settlement transition on
 * screen is an actual await rather than a decoration.
 */
export const demoGateway: PaymentsGateway = {
  async loadSnapshot() {
    await wait(320);
    return snapshotSchema.parse(SNAPSHOT);
  },

  async quoteSend(amountMinor) {
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    const rate = { koboPerDollar: snapshot.account.koboPerDollar, quotedAt: new Date().toISOString() };
    return {
      amountMinor,
      feeMinor: FEE_MINOR,
      totalMinor: amountMinor + FEE_MINOR,
      receivesCents: Math.round((amountMinor * 100) / rate.koboPerDollar),
      rate,
    };
  },

  async submitPayment(input) {
    const sentAt = new Date();
    await wait(SETTLEMENT_MS);
    const settled = new Date(sentAt.getTime() + SETTLEMENT_MS);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    const rate = snapshot.account.koboPerDollar;

    return receiptSchema.parse({
      id: `rc-${sentAt.getTime()}`,
      reference: reference(),
      contactId: input.contactId,
      amountMinor: input.amountMinor,
      feeMinor: FEE_MINOR,
      receivedMinor: Math.round((input.amountMinor * 100) / rate),
      koboPerDollar: rate,
      sentAt: sentAt.toISOString(),
      settledAt: settled.toISOString(),
      deliveredInSeconds: Math.max(1, Math.round(SETTLEMENT_MS / 1000)),
    });
  },

  async setPaused() {
    await wait(160);
  },

  async saveAllowance(draft) {
    await wait(220);
    return {
      id: draft.id ?? `a-${Date.now()}`,
      name: draft.name,
      recipientId: draft.recipientId,
      limitMinor: draft.limitMinor,
      spentMinor: 0,
      perRunMinor: draft.perRunMinor,
      cadence: draft.cadence,
      resetsAt: '2026-10-01T00:00:00.000+01:00',
      paused: false,
    };
  },

  async revokeAllowance() {
    await wait(200);
  },

  async cancelProposal() {
    await wait(120);
  },

  async saveSeat(draft) {
    await wait(220);
    return seatSchema.parse({
      id: draft.id ?? `s-${Date.now()}`,
      name: draft.name,
      contactId: draft.contactId,
      role: draft.role,
      limitMinor: draft.limitMinor,
      spentMinor: 0,
      perRunMinor: draft.perRunMinor,
      cadence: draft.cadence,
      resetsAt: '2026-10-01T00:00:00.000+01:00',
      paused: false,
    });
  },

  async revokeSeat() {
    await wait(200);
  },

  async createInvoice(draft) {
    await wait(220);
    const id = `inv-${Date.now()}`;
    return invoiceSchema.parse({
      id,
      clientName: draft.clientName,
      amountMinor: draft.amountMinor,
      note: draft.note,
      dueAt: draft.dueAt,
      status: draft.releaseCondition ? 'pending-release' : 'sent',
      link: `entole.to/${id}`,
      ...(draft.releaseCondition ? { releaseCondition: draft.releaseCondition } : {}),
    });
  },

  async settleInvoice(invoiceId, taxFraction) {
    await wait(320);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    const invoice = snapshot.invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) throw new Error(`No invoice ${invoiceId}`);
    return settleInvoiceRecord(invoice, snapshot.account.koboPerDollar, taxFraction);
  },

  async requestConditionalRelease(invoiceId, observedRate) {
    await wait(280);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    const invoice = snapshot.invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) throw new Error(`No invoice ${invoiceId}`);
    return releaseConditionalInvoice(invoice, observedRate);
  },

  async createProcurementRequest(draft) {
    await wait(220);
    return procurementRequestSchema.parse({
      id: `po-${Date.now()}`,
      supplierName: draft.supplierName,
      items: draft.items,
      ...(draft.note ? { note: draft.note } : {}),
      status: 'requested',
      requestedAt: new Date().toISOString(),
    });
  },

  async depositGrow(amountMinor) {
    await wait(320);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    return growPositionSchema.parse({
      ...snapshot.growPosition,
      balanceMinor: snapshot.growPosition!.balanceMinor + amountMinor,
    });
  },

  async withdrawGrow(amountMinor) {
    await wait(320);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    if (amountMinor > snapshot.growPosition!.balanceMinor) {
      throw new Error('Cannot withdraw more than the growing balance');
    }
    return growPositionSchema.parse({
      ...snapshot.growPosition,
      balanceMinor: snapshot.growPosition!.balanceMinor - amountMinor,
    });
  },

  stocksAvailable: true,

  async searchStocks(query) {
    await wait(120);
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return DEMO_STOCKS.filter(
      (s) => s.symbol.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle),
    ).map(({ symbol, name }) => ({ symbol, name }));
  },

  async getStockQuote(symbol) {
    await wait(120);
    const stock = demoStock(symbol);
    return { symbol: stock.symbol, priceMinor: stock.priceMinor, asOf: new Date().toISOString() };
  },

  async buyStock(symbol, quantityScaled) {
    await wait(320);
    const stock = demoStock(symbol);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    return applyStockTrade(
      snapshot.stockPositions,
      { symbol: stock.symbol, companyName: stock.name },
      quantityScaled,
      stock.priceMinor,
    );
  },

  async sellStock(symbol, quantityScaled) {
    await wait(320);
    const stock = demoStock(symbol);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    return applyStockTrade(
      snapshot.stockPositions,
      { symbol: stock.symbol, companyName: stock.name },
      -quantityScaled,
      stock.priceMinor,
    );
  },
};
