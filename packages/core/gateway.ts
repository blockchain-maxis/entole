import { SNAPSHOT } from './fixtures';
import {
  receiptSchema,
  snapshotSchema,
  type Allowance,
  type Cadence,
  type Receipt,
  type Snapshot,
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
};
