import { parseEventLogs, type Address, type Log } from 'viem';

import type { Rate } from '@entole/core/fx';
import {
  keptPaymentSchema,
  paymentReference,
  receivedPaymentSchema,
  type KeptPayment,
  type ReceivedPayment,
} from '@entole/core/payments-feed';

import { getRedis } from './redis';

/**
 * Payments kept for the people they were sent to, so a payment shows in the
 * receiver's activity and they can be told it arrived. Server-only.
 *
 * Nothing is written here on anyone's say-so. A record is made from what the
 * network itself says about a payment: that it settled, who it went to and how
 * much arrived. `readSettledPayment` is that reading. The two things the
 * network does not hold, the sender's note and the naira figure they typed,
 * are taken from the sender, and the naira figure only when it agrees with the
 * amount that really moved (`settledNaira`).
 */

/** How many arrived payments are kept per person. The device keeps its own copy once it has seen them. */
const KEEP = 200;

const inKey = (address: Address) => `payments:in:${address.toLowerCase()}`;
/** One payment, by the reference its receipt prints. It is also what makes a payment kept only once. */
const refKey = (reference: string) => `payments:ref:${reference.toUpperCase()}`;

export function paymentsConfigured(): boolean {
  return getRedis() !== null;
}

const EVENTS = [
  {
    type: 'event',
    name: 'Paid',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
      { name: 'salt', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Who a settled payment went to and how much arrived, read from the payment's
 * own record on the network. `null` when the record does not show `payer`
 * paying anyone.
 *
 * An ordinary send goes through the router, which says so in one line: who
 * paid, who was paid, how much they got. A payment the assistant makes inside
 * an allowance, or a plain transfer, shows only as the money itself moving
 * from the payer to the person paid.
 */
export function readSettledPayment(
  logs: readonly Log[],
  input: { payer: Address; router: Address | null; token: Address },
): { recipient: Address; amountToken: bigint } | null {
  const events = parseEventLogs({ abi: EVENTS, logs: logs as Log[] });

  if (input.router) {
    for (const event of events) {
      if (event.eventName !== 'Paid' || !same(event.address, input.router)) continue;
      if (!same(event.args.from, input.payer) || same(event.args.recipient, input.payer)) continue;
      return { recipient: event.args.recipient, amountToken: event.args.amount };
    }
  }

  for (const event of events) {
    if (event.eventName !== 'Transfer' || !same(event.address, input.token)) continue;
    if (!same(event.args.from, input.payer) || same(event.args.to, input.payer)) continue;
    // Money handed to the router is on its way to someone; the router's own
    // line, above, is what says who. Without that line this is not a payment
    // to a person.
    if (input.router && same(event.args.to, input.router)) continue;
    if (event.args.value === 0n) continue;
    return { recipient: event.args.to, amountToken: event.args.value };
  }
  return null;
}

/** How far a rate the sender was shown may sit from the rate the server has, and still be believed. */
const RATE_TOLERANCE = 0.03;

/**
 * The naira figure to keep for a payment, in kobo, or `undefined` when none
 * can be stood behind.
 *
 * The sender typed a naira amount; what moved was dollars, to the cent. Worked
 * back from the dollars, the figure can land a few naira off what was typed
 * (₦5,000 comes back as ₦4,996), which reads as though some went missing. So
 * the typed figure is kept, but only when it could have produced the amount
 * that moved: it must agree to within one cent's worth, at a rate close to the
 * one the server has. A sender cannot make ₦5,000 read as ₦500,000 by claiming
 * a rate nobody was offering.
 */
export function settledNaira(input: {
  amountToken: bigint;
  tokenDecimals: number;
  rate: Rate | null;
  stated?: { amountMinor: number; koboPerDollar: number } | undefined;
}): number | undefined {
  const { rate, stated } = input;
  if (!rate) return undefined;
  const cents = Number(input.amountToken) / 10 ** (input.tokenDecimals - 2);
  const worked = (koboPerDollar: number) => Math.round((cents * koboPerDollar) / 100);

  if (stated && stated.koboPerDollar > 0) {
    const near = Math.abs(stated.koboPerDollar - rate.koboPerDollar) <= rate.koboPerDollar * RATE_TOLERANCE;
    const oneCent = Math.ceil(stated.koboPerDollar / 100);
    if (near && Math.abs(stated.amountMinor - worked(stated.koboPerDollar)) <= oneCent) return stated.amountMinor;
  }
  return worked(rate.koboPerDollar);
}

/**
 * Keeps a payment: under its reference, which is what a receipt is drawn from,
 * and in the list of the person it was sent to. A payment is kept once: the
 * second report of the same one changes nothing and returns `false`.
 */
export async function recordReceived(payment: KeptPayment): Promise<boolean> {
  const db = getRedis();
  if (!db) throw new Error('not_configured');
  const reference = refKey(paymentReference(payment.hash));
  const first = await db.set(reference, payment, { nx: true });
  if (first === null) return false;

  const { to, toName: _toName, toUsername: _toUsername, ...arrived } = payment;
  try {
    await db.lpush(inKey(to as Address), arrived satisfies ReceivedPayment);
    await db.ltrim(inKey(to as Address), 0, KEEP - 1);
  } catch (error) {
    // Not kept after all: let the next report of it try again.
    await db.del(reference).catch(() => undefined);
    throw error;
  }
  return true;
}

/**
 * One payment by the reference on its receipt, or `null`. What comes back was
 * read from the network when it was kept, so a receipt drawn from it is a
 * receipt for a payment that happened.
 */
export async function getByReference(reference: string): Promise<KeptPayment | null> {
  if (!/^[0-9A-Fa-f]{12}$/.test(reference)) return null;
  const db = getRedis();
  if (!db) return null;
  const parsed = keptPaymentSchema.safeParse(await db.get<unknown>(refKey(reference)));
  return parsed.success ? parsed.data : null;
}

/** What has arrived for someone, newest first. */
export async function listReceived(to: Address): Promise<ReceivedPayment[]> {
  const db = getRedis();
  if (!db) return [];
  const rows = await db.lrange<unknown>(inKey(to), 0, KEEP - 1);
  return rows.flatMap((row) => {
    const parsed = receivedPaymentSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
