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

export const potMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  initials: z.string().min(1).max(2),
  tone: avatarToneSchema,
  paidMinor: nonNegativeMinor,
  owedMinor: nonNegativeMinor,
  isYou: z.boolean(),
});

export const potSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  targetMinor: nonNegativeMinor,
  collectedMinor: nonNegativeMinor,
  startedByYou: z.boolean(),
  members: z.array(potMemberSchema).min(1),
  assistantNote: z.string().optional(),
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
  pots: z.array(potSchema),
  request: paymentRequestSchema,
  proposal: proposalSchema,
});

export type Contact = z.infer<typeof contactSchema>;
export type Allowance = z.infer<typeof allowanceSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Cadence = z.infer<typeof cadenceSchema>;
export type Pot = z.infer<typeof potSchema>;
export type PotMember = z.infer<typeof potMemberSchema>;
export type PaymentRequest = z.infer<typeof paymentRequestSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type AvatarTone = z.infer<typeof avatarToneSchema>;
