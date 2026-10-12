import type { Address } from 'viem';
import { z } from 'zod';

import { oneOffId } from './one-off';
import { encodePaymentCode } from './payment-code';
import { activitySchema, type Activity } from './schemas';

/**
 * Money that arrived. The server side lives in `apps/web/app/api/payments`.
 *
 * A send is recorded on the sender's own device, which is why for a long time
 * the person receiving it saw their balance rise and nothing else: no entry,
 * no word that it had come. This is the other half. When a payment settles,
 * the sender's app tells the server which one it was. The server reads that
 * payment back from the network itself, so what it writes down is what
 * happened and not what it was told, and keeps it for the person it was sent
 * to. Their app collects it the next time it looks, puts it in their activity
 * and says that it arrived.
 *
 * Two things in a record are not on the network and come from the sender: the
 * note they wrote, and the naira figure they typed. The note is theirs to
 * write. The naira figure is only kept when it agrees with the amount that
 * really moved at the rate of the day; otherwise the server works it out.
 */

export const PAYMENT_NOTE_MAX = 140;

/** A request signature older than this is refused. A staleness window, not a replay window. */
export const FEED_MAX_AGE_SECONDS = 300;

const hashField = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/**
 * The exact text a request is signed over. Built the same way on the device
 * before signing and on the server before checking. The action and the
 * payment are inside it, so permission to read can never be replayed as a
 * record, nor a record of one payment as a record of another.
 */
export function buildFeedMessage(input: {
  account: Address;
  action: 'record' | 'list';
  hash?: string;
  timestampSeconds: number;
}): string {
  return [
    'Entole payments',
    `account: ${input.account.toLowerCase()}`,
    `action: ${input.action}`,
    `payment: ${input.hash ? input.hash.toLowerCase() : 'none'}`,
    `timestamp: ${input.timestampSeconds}`,
  ].join('\n');
}

/** A payment someone received, as the server keeps it for them. */
export const receivedPaymentSchema = z.object({
  /** Which payment. Never shown; it is what makes the entry one entry. */
  hash: hashField,
  /** Who sent it: their account. Never put on a screen. */
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Who sent it, as the directory named them when it settled. */
  fromName: z.string().min(1).max(60).optional(),
  fromUsername: z.string().min(1).max(20).optional(),
  /** What arrived, in the settlement asset's base units. Read from the network. */
  amountToken: z.string().regex(/^\d{1,78}$/),
  /** The same amount in kobo, at the rate when it settled. Missing when no rate could be had. */
  amountMinor: z.number().int().nonnegative().optional(),
  /** When it settled, by the network's clock. */
  at: z.string().datetime({ offset: true }),
  /** The sender's own words, when they wrote any. */
  note: z.string().min(1).max(PAYMENT_NOTE_MAX).optional(),
});

export type ReceivedPayment = z.infer<typeof receivedPaymentSchema>;

/** What the sender's app says about a payment that has settled. */
export type SettledPaymentReport = {
  hash: string;
  note?: string;
  /** The naira the sender typed, in kobo, and the rate it was shown at. */
  amountMinor?: number;
  koboPerDollar?: number;
};

export type PaymentsFeed = {
  /** Tells the server a payment settled, so the person it was sent to can be shown it. Best effort. */
  record(report: SettledPaymentReport): Promise<boolean>;
  /** What has arrived for this account, newest first. Empty when the server cannot be asked. */
  list(): Promise<ReceivedPayment[]>;
};

export function createPaymentsFeedClient(options: {
  baseUrl: string;
  /** The account this client speaks for: the sender when recording, the receiver when listing. */
  account: Address;
  sign: (message: string) => Promise<`0x${string}`>;
  fetch?: typeof fetch;
}): PaymentsFeed {
  const fetchImpl = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function call(action: 'record' | 'list', extra: Record<string, unknown> = {}): Promise<unknown | null> {
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const hash = typeof extra.hash === 'string' ? extra.hash : undefined;
    let signature: `0x${string}`;
    try {
      signature = await options.sign(
        buildFeedMessage({ account: options.account, action, ...(hash ? { hash } : {}), timestampSeconds }),
      );
    } catch {
      return null;
    }
    try {
      const response = await fetchImpl(`${base}/api/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: options.account, action, timestampSeconds, signature, ...extra }),
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  return {
    async record(report) {
      const note = report.note?.replace(/\s+/g, ' ').trim().slice(0, PAYMENT_NOTE_MAX);
      const json = await call('record', {
        hash: report.hash,
        ...(note ? { note } : {}),
        ...(report.amountMinor !== undefined ? { amountMinor: report.amountMinor } : {}),
        ...(report.koboPerDollar !== undefined ? { koboPerDollar: report.koboPerDollar } : {}),
      });
      return z.object({ ok: z.literal(true) }).safeParse(json).success;
    },
    async list() {
      const json = await call('list');
      const parsed = z.object({ payments: z.array(z.unknown()) }).safeParse(json);
      if (!parsed.success) return [];
      // One bad record must not hide the rest.
      return parsed.data.payments.flatMap((item) => {
        const payment = receivedPaymentSchema.safeParse(item);
        return payment.success ? [payment.data] : [];
      });
    },
  };
}

/**
 * The reference a payment goes by: what a receipt prints, and what the person
 * who paid and the person who was paid can both quote. Short enough to read
 * out, and the same wherever it is worked out.
 */
export function paymentReference(hash: string): string {
  return hash.slice(2, 14).toUpperCase();
}

/** A payment as the server keeps it: what arrived, and who it was for. */
export const keptPaymentSchema = receivedPaymentSchema.extend({
  /** Who it was sent to: their account. Never put on a screen. */
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** Who it was sent to, as the directory named them when it settled. */
  toName: z.string().min(1).max(60).optional(),
  toUsername: z.string().min(1).max(20).optional(),
});

export type KeptPayment = z.infer<typeof keptPaymentSchema>;

/** The id an activity entry for a payment goes by: the same on both ends of it. */
export function activityIdFor(hash: string): string {
  return `rc-${hash}`;
}

/**
 * A payment that arrived, as an entry in the receiver's activity.
 *
 * `savedContactId` is the sender when the receiver has them saved, so they show
 * as the receiver knows them. Otherwise they are named as the directory names
 * them, carried in a one-off id the way an unsaved recipient is. `fallbackMinor`
 * is the receiver's own working of the amount, used when the server could not
 * put a naira figure on it.
 */
export function activityFromReceived(
  payment: ReceivedPayment,
  options: { savedContactId?: string | undefined; fallbackMinor: number },
): Activity | null {
  const contactId =
    options.savedContactId ?? oneOffId(encodePaymentCode(payment.from.toLowerCase() as Address), payment.fromName);
  if (!contactId) return null;
  const entry = activitySchema.safeParse({
    id: activityIdFor(payment.hash),
    contactId,
    note: payment.note ?? 'Received',
    at: payment.at,
    amountMinor: payment.amountMinor ?? options.fallbackMinor,
    direction: 'in',
    initiatedBy: 'you',
    state: 'settled',
  });
  return entry.success ? entry.data : null;
}
