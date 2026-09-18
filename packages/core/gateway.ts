import { evaluateReleaseCondition } from './chainlink-cre';
import { SNAPSHOT } from './fixtures';
import type { Rate } from './fx';
import {
  growPositionSchema,
  invoiceSchema,
  receiptSchema,
  seatSchema,
  snapshotSchema,
  taxReserveSchema,
  type Allowance,
  type Cadence,
  type GrowPosition,
  type Invoice,
  type Receipt,
  type ReleaseCondition,
  type Seat,
  type SeatRole,
  type Snapshot,
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
  /** Marks an invoice paid and splits `taxFraction` of it into the named
   * tax reserve, at source — the same instant the money arrives, not a
   * step someone has to remember. */
  settleInvoice(invoiceId: string, taxFraction: number): Promise<{ invoice: Invoice; taxReserve: TaxReserve }>;
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

  /** "Grow" — the owner acting on their own deposited balance directly, no
   * delegate/allowance involved. Both resolve only once settled, same
   * promise `submitPayment` makes. */
  depositGrow(amountMinor: number): Promise<GrowPosition>;
  withdrawGrow(amountMinor: number): Promise<GrowPosition>;
}

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
  /** Present only for a Chainlink CRE-gated invoice — see chainlink-cre.ts. */
  releaseCondition?: ReleaseCondition;
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
 * Demo gateway. Timings imitate real finality, so the settlement transition on
 * screen is an actual await rather than a decoration.
 */
export const demoGateway: PaymentsGateway = {
  async loadSnapshot() {
    await wait(320);
    return snapshotSchema.parse(SNAPSHOT);
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
    if (!invoice.releaseCondition) {
      throw new Error(`Invoice ${invoiceId} has no release condition to evaluate`);
    }
    if (!evaluateReleaseCondition(invoice.releaseCondition, observedRate)) return null;
    return settleInvoiceRecord(invoice, observedRate.koboPerDollar, 0.2);
  },

  async depositGrow(amountMinor) {
    await wait(320);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    return growPositionSchema.parse({
      ...snapshot.growPosition,
      balanceMinor: snapshot.growPosition.balanceMinor + amountMinor,
    });
  },

  async withdrawGrow(amountMinor) {
    await wait(320);
    const snapshot = snapshotSchema.parse(SNAPSHOT);
    if (amountMinor > snapshot.growPosition.balanceMinor) {
      throw new Error('Cannot withdraw more than the growing balance');
    }
    return growPositionSchema.parse({
      ...snapshot.growPosition,
      balanceMinor: snapshot.growPosition.balanceMinor - amountMinor,
    });
  },
};
