import type { Address } from 'viem';
import { z } from 'zod';

import type { Rate } from './fx';
import { oneOffId } from './one-off';
import { encodePaymentCode } from './payment-code';
import { activityIdFor } from './payments-feed';
import { activitySchema, type Activity } from './schemas';

/**
 * A person's payments, read from the index.
 *
 * `indexer/` keeps one `Payment` row for every payment an Entole account
 * sends or receives, whichever door it went through: an ordinary send through
 * the router, or one the assistant made inside an allowance. This asks it for
 * one account's rows, both directions, and turns them into the same `Activity`
 * every screen already renders. It is docs/ARCHITECTURE.md's rule kept for
 * real: "Do not read history directly from RPC in the app."
 *
 * What it is for. A send is written to the device that made it, and a payment
 * that arrives is collected from the server when the sender's app reported
 * it. Both can miss: a new phone knows nothing, and a sender's app can close
 * before it reports. The index misses neither, because it reads the payment
 * network itself. So this fills in what the device does not have, and never
 * replaces what it does.
 *
 * What it cannot give. The note is not on the network; an entry found here
 * says "Sent" or "Received". And the naira figure is worked out from what
 * moved at the rate when the entry is first seen, not the rate on the day.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
/** A `BigInt` scalar: always a string over the wire, never trusted as a JS number. */
const bigint = z.union([z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative().transform(String)]);

export const indexedPaymentSchema = z.object({
  id: z.string().min(1),
  from: address,
  to: address,
  /** What the person paid received, in the settlement asset's base units. */
  amount: bigint,
  /** Unix seconds. */
  timestamp: bigint,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  byAssistant: z.boolean(),
});

export type IndexedPayment = z.infer<typeof indexedPaymentSchema>;

const PAYMENTS_QUERY = /* GraphQL */ `
  query PaymentsOf($me: String!, $limit: Int!) {
    Payment(
      where: { _or: [{ from: { _eq: $me } }, { to: { _eq: $me } }] }
      order_by: { timestamp: desc }
      limit: $limit
    ) {
      id
      from
      to
      amount
      timestamp
      txHash
      byAssistant
    }
  }
`;

/**
 * One account's payments from a running index, newest first. Throws when the
 * index cannot be asked or answers with an error: the caller decides what that
 * means, and it must never be mistaken for "there are none". A row that does
 * not read is left out rather than guessed at.
 */
export async function fetchIndexedPayments(options: {
  indexerUrl: string;
  account: Address;
  limit?: number;
  fetch?: typeof fetch;
}): Promise<IndexedPayment[]> {
  const response = await (options.fetch ?? fetch)(options.indexerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: PAYMENTS_QUERY,
      // The index keeps accounts lower-case (`address_format` in its config).
      variables: { me: options.account.toLowerCase(), limit: options.limit ?? 100 },
    }),
  });
  if (!response.ok) throw new Error(`Indexer request failed: ${response.status}`);

  const body = (await response.json()) as { data?: { Payment?: unknown }; errors?: unknown };
  if (body.errors || !Array.isArray(body.data?.Payment)) throw new Error('Indexer returned an error');

  return body.data.Payment.flatMap((row) => {
    const parsed = indexedPaymentSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Who is on the other end of a payment, from this account's side. `null` for a payment to oneself. */
export function counterpartyOf(payment: IndexedPayment, account: Address): { address: Address; direction: 'in' | 'out' } | null {
  const me = account.toLowerCase();
  const from = payment.from.toLowerCase();
  const to = payment.to.toLowerCase();
  if (from === to) return null;
  if (to === me) return { address: from as Address, direction: 'in' };
  if (from === me) return { address: to as Address, direction: 'out' };
  return null;
}

function fromTokenMinor(amountToken: bigint, tokenDecimals: number, rate: Rate): number {
  const tokenToNairaCents = Number(amountToken) / 10 ** (tokenDecimals - 2);
  return Math.round((tokenToNairaCents * rate.koboPerDollar) / 100);
}

/**
 * A payment from the index as an activity entry, or `null` for one that is
 * not this account's. Its id is the same one the device gives a payment it
 * made and the server gives one that arrived, so the three never show one
 * payment twice.
 *
 * The other person is whoever the device has saved under that account, or
 * else is named as `nameOf` names them, carried in a one-off id; with no name
 * they are simply an Entole account. Never an address.
 */
export function mapPaymentToActivity(
  payment: IndexedPayment,
  options: {
    account: Address;
    resolveContactId?: ((address: Address) => string | undefined) | undefined;
    nameOf?: ((address: Address) => string | undefined) | undefined;
    tokenDecimals: number;
    rate: Rate;
  },
): Activity | null {
  const other = counterpartyOf(payment, options.account);
  if (!other) return null;

  const contactId =
    options.resolveContactId?.(other.address) ??
    oneOffId(encodePaymentCode(other.address), options.nameOf?.(other.address));
  if (!contactId) return null;

  const entry = activitySchema.safeParse({
    id: activityIdFor(payment.txHash.toLowerCase()),
    contactId,
    note: other.direction === 'in' ? 'Received' : 'Sent',
    at: new Date(Number(payment.timestamp) * 1000).toISOString(),
    amountMinor: fromTokenMinor(BigInt(payment.amount), options.tokenDecimals, options.rate),
    direction: other.direction,
    // A payment the assistant made is the assistant's on the side that made it.
    initiatedBy: payment.byAssistant && other.direction === 'out' ? 'assistant' : 'you',
    state: 'settled',
  });
  return entry.success ? entry.data : null;
}
