import { z } from 'zod';

/**
 * Every response that crosses a boundary is parsed here before it is used.
 * Amounts arrive as integer minor units and stay that way.
 */

const minor = z.number().int();
const nonNegativeMinor = minor.nonnegative();
const isoDate = z.string().datetime({ offset: true });

export const avatarToneSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const contactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  initials: z.string().min(1).max(2),
  phone: z.string().optional(),
  /** "Lagos · Zenith Bank" — where the money lands, in the recipient's words. */
  place: z.string().optional(),
  /** "Zenith Bank · ••4471" — masked destination, shown on receipts only. */
  destination: z.string().optional(),
  tone: avatarToneSchema,
});

export const cadenceSchema = z.enum(['weekly', 'monthly', 'on-request']);

export const allowanceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  recipientId: z.string().min(1),
  /** Per-period cap, enforced by the policy contract, not by this app. */
  limitMinor: nonNegativeMinor,
  spentMinor: nonNegativeMinor,
  /** What each run sends. */
  perRunMinor: nonNegativeMinor,
  cadence: cadenceSchema,
  resetsAt: isoDate,
  paused: z.boolean(),
});

export const activityStateSchema = z.enum(['pending', 'settled']);

export const activitySchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
  note: z.string().min(1),
  at: isoDate,
  amountMinor: nonNegativeMinor,
  direction: z.enum(['in', 'out']),
  /** Assistant-initiated entries render with the assistant tint everywhere. */
  initiatedBy: z.enum(['you', 'assistant']),
  state: activityStateSchema,
  allowanceId: z.string().optional(),
});

/**
 * Business layer — added 17 September 2026, see docs/SCOPE.md. Every shape
 * here rides the same caveat model as a personal allowance: a cap, a
 * cadence, a balance. A seat is spending power granted to a person instead
 * of to the assistant; nothing here introduces a second trust model.
 */

export const seatRoleSchema = z.enum(['admin', 'officer', 'bookkeeper']);

export const seatSchema = z.object({
  id: z.string().min(1),
  /** "Officer — travel & supplies" — chosen at grant time, same as an
   * allowance's own name. */
  name: z.string().min(1),
  contactId: z.string().min(1),
  role: seatRoleSchema,
  /** Officer seats carry a real cap. Admin and bookkeeper seats carry a
   * zero cap — admin manages seats and allowances rather than spending
   * directly, bookkeeper is read-only. */
  limitMinor: nonNegativeMinor,
  spentMinor: nonNegativeMinor,
  perRunMinor: nonNegativeMinor,
  cadence: cadenceSchema,
  resetsAt: isoDate,
  paused: z.boolean(),
});

export const invoiceStatusSchema = z.enum(['draft', 'sent', 'pending-release', 'paid']);

/**
 * An off-chain condition gating an invoice's release — the Chainlink CRE
 * bounty claim, see `packages/core/chainlink-cre.ts`. `'pending-release'`
 * invoices carry one of these; released only once it evaluates true.
 */
export const releaseConditionSchema = z.object({
  type: z.literal('fx-rate-at-or-below'),
  /** Release only once the settlement rate is at or below this — protects
   * the business from an adverse FX swing between invoice and release. */
  maxKoboPerDollar: z.number().int().positive(),
});

export const invoiceSchema = z.object({
  id: z.string().min(1),
  clientName: z.string().min(1),
  amountMinor: nonNegativeMinor,
  note: z.string().min(1),
  dueAt: isoDate,
  status: invoiceStatusSchema,
  /** Reuses the same receive-by-link surface a personal payment request
   * already has — not a second flow. */
  link: z.string().min(1),
  koboPerDollar: z.number().int().positive().optional(),
  paidAt: isoDate.optional(),
  releaseCondition: releaseConditionSchema.optional(),
});

export const procurementItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const procurementStatusSchema = z.enum(['requested']);

/**
 * "Order Supplies" — a request-drafting record, not a fulfillment
 * integration. There is no supplier marketplace behind this; it exists so a
 * request has a real, Zod-validated home instead of vanishing as
 * ephemeral client state the moment the screen closes.
 */
export const procurementRequestSchema = z.object({
  id: z.string().min(1),
  supplierName: z.string().min(1),
  items: z.array(procurementItemSchema).min(1),
  note: z.string().optional(),
  status: procurementStatusSchema,
  requestedAt: isoDate,
});

export const taxReserveSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  balanceMinor: nonNegativeMinor,
  /** Earmarking, not investment — no yield accrues here. See docs/SCOPE.md,
   * "Cut from the pitch." */
  payoutAt: isoDate,
  sourceInvoiceId: z.string().optional(),
});

/**
 * A "Grow" position — the balance behind the growth-vault feature. Accrual
 * is display-layer projection only (see `packages/core/grow.ts`); the only
 * number this schema is honest about is what actually settled on-chain:
 * deposited minus withdrawn.
 */
export const growPositionSchema = z.object({
  balanceMinor: nonNegativeMinor,
  /** Simulated/projected earnings not yet paid out — never treated as
   * spendable balance, only shown as a projection. */
  accruedMinor: nonNegativeMinor,
  nextPayoutAt: isoDate,
});

/**
 * A "Stocks" holding — the Grow hub's second product, alongside the
 * growth-vault Savings position above. Share counts can be fractional, so
 * `quantityScaled` is a fixed-point integer (4 decimal places — e.g. 2.5
 * shares is stored as `25000`) rather than a float, the same discipline
 * `amountMinor` applies to money. Cash fields stay integer minor units.
 */
export const stockPositionSchema = z.object({
  symbol: z.string().min(1),
  companyName: z.string().min(1),
  /** Fixed-point, 4 decimal places — see this schema's own doc comment. */
  quantityScaled: z.number().int().nonnegative(),
  costBasisMinor: nonNegativeMinor,
  currentValueMinor: nonNegativeMinor,
});

export const paymentRequestSchema = z.object({
  id: z.string().min(1),
  requesterName: z.string().min(1),
  amountMinor: nonNegativeMinor,
  note: z.string().min(1),
  link: z.string().min(1),
});

export const receiptSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  contactId: z.string().min(1),
  amountMinor: nonNegativeMinor,
  feeMinor: nonNegativeMinor,
  receivedMinor: nonNegativeMinor,
  koboPerDollar: z.number().int().positive(),
  sentAt: isoDate,
  settledAt: isoDate,
  deliveredInSeconds: z.number().int().nonnegative(),
});

export const proposalSchema = z.object({
  id: z.string().min(1),
  allowanceId: z.string().min(1),
  contactId: z.string().min(1),
  amountMinor: nonNegativeMinor,
  note: z.string().min(1),
  /** Length of the undo window. There is no confirmation dialog. */
  undoSeconds: z.number().int().positive(),
});

export const accountSchema = z.object({
  balanceMinor: nonNegativeMinor,
  koboPerDollar: z.number().int().positive(),
  paused: z.boolean(),
});

export const snapshotSchema = z.object({
  account: accountSchema,
  contacts: z.array(contactSchema),
  allowances: z.array(allowanceSchema),
  activity: z.array(activitySchema),
  seats: z.array(seatSchema),
  invoices: z.array(invoiceSchema),
  procurementRequests: z.array(procurementRequestSchema),
  taxReserves: z.array(taxReserveSchema),
  growPosition: growPositionSchema,
  stockPositions: z.array(stockPositionSchema),
  request: paymentRequestSchema,
  proposal: proposalSchema,
});

export type Contact = z.infer<typeof contactSchema>;
export type Allowance = z.infer<typeof allowanceSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Cadence = z.infer<typeof cadenceSchema>;
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type AvatarTone = z.infer<typeof avatarToneSchema>;
export type SeatRole = z.infer<typeof seatRoleSchema>;
export type Seat = z.infer<typeof seatSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type ProcurementItem = z.infer<typeof procurementItemSchema>;
export type ProcurementRequest = z.infer<typeof procurementRequestSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type ReleaseCondition = z.infer<typeof releaseConditionSchema>;
export type TaxReserve = z.infer<typeof taxReserveSchema>;
export type GrowPosition = z.infer<typeof growPositionSchema>;
export type StockPosition = z.infer<typeof stockPositionSchema>;
