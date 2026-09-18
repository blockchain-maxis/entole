import { keccak256, toHex, type Address } from 'viem';

import type { Rate } from './fx';
import { activitySchema, type Activity, type Allowance } from './schemas';

/**
 * Turns Envio HyperIndex's `Execution` rows (see `indexer/schema.graphql`)
 * into the same `Activity` shape every screen already renders, per
 * docs/ARCHITECTURE.md: "Envio HyperIndex for activity feeds and allowance
 * history. Do not read history directly from RPC in the app." This is that
 * rule, satisfied for real — not a second mock, an alternate *source* for
 * the one `Activity[]` shape the store already exposes.
 *
 * Known gap: `Execution` only exists for `EntolePolicy.execute()` calls —
 * i.e. allowance-gated, assistant-initiated payments. A direct owner→contact
 * send (`packages/core/onchain-gateway.ts`'s ERC20 `transfer` path) never
 * touches `EntolePolicy` and so never emits an event this indexer watches.
 * Indexing those too means watching the settlement token's own `Transfer`
 * event — a real follow-up, out of this pass's scope. Until then, direct
 * sends still show up locally (the session that made them appends its own
 * activity entry — see `store.tsx`'s `send`), they just won't survive a
 * fresh load from another device the way indexed executions do.
 */

export type IndexedExecution = {
  id: string;
  allowance_id: string;
  recipient: string;
  /** Token minor units, as the GraphQL layer returns a `BigInt` scalar —
   * always a string over the wire, never trust it as a JS number. */
  amountMinor: string;
  /** Unix seconds, same `BigInt`-as-string wire shape. */
  timestamp: string;
  txHash: string;
};

const EXECUTIONS_QUERY = /* GraphQL */ `
  query RecentExecutions($limit: Int!) {
    Execution(order_by: { timestamp: desc }, limit: $limit) {
      id
      allowance_id
      recipient
      amountMinor
      timestamp
      txHash
    }
  }
`;

export type FetchIndexedActivityOptions = {
  indexerUrl: string;
  /** Every allowance the off-chain snapshot knows about — used two ways:
   * matching an indexed row's on-chain `allowance_id` back to the app's own
   * allowance id (the hash is one-way, so this checks known ids rather than
   * reversing it), and borrowing that allowance's name as the entry's note,
   * since the indexer only ever sees the on-chain shape, never the label a
   * person picked when they created it. */
  knownAllowances: Allowance[];
  resolveContactId: (address: Address) => string | undefined;
  tokenDecimals: number;
  rate: Rate;
  limit?: number;
};

function fromTokenMinor(amountToken: bigint, tokenDecimals: number, rate: Rate): number {
  const tokenToNairaCents = Number(amountToken) / 10 ** (tokenDecimals - 2);
  return Math.round((tokenToNairaCents * rate.koboPerDollar) / 100);
}

/** Pure mapping, no network — the thing under test. Returns `null` for a
 * row this app can't render honestly: an unresolvable recipient (not a
 * fixture contact) or an `allowance_id` that matches no known allowance.
 * Skipping beats guessing. */
export function mapExecutionToActivity(
  execution: IndexedExecution,
  options: Pick<FetchIndexedActivityOptions, 'knownAllowances' | 'resolveContactId' | 'tokenDecimals' | 'rate'>,
): Activity | null {
  const contactId = options.resolveContactId(execution.recipient as Address);
  if (!contactId) return null;

  const allowance = options.knownAllowances.find(
    (a) => keccak256(toHex(a.id)).toLowerCase() === execution.allowance_id.toLowerCase(),
  );
  if (!allowance) return null;

  return activitySchema.parse({
    id: execution.id,
    contactId,
    note: allowance.name,
    at: new Date(Number(execution.timestamp) * 1000).toISOString(),
    amountMinor: fromTokenMinor(BigInt(execution.amountMinor), options.tokenDecimals, options.rate),
    direction: 'out',
    initiatedBy: 'assistant',
    state: 'settled',
    allowanceId: allowance.id,
  });
}

/**
 * Queries a running Envio HyperIndex GraphQL endpoint and maps the result to
 * `Activity[]`. Throws on a network/GraphQL error — the caller (`onchain-
 * gateway.ts`) decides whether to fall back to the off-chain snapshot's
 * activity, not this function; it must never return partial or fabricated
 * data silently.
 */
export async function fetchIndexedActivity(options: FetchIndexedActivityOptions): Promise<Activity[]> {
  const response = await fetch(options.indexerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: EXECUTIONS_QUERY, variables: { limit: options.limit ?? 50 } }),
  });

  if (!response.ok) {
    throw new Error(`Indexer request failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { data?: { Execution?: IndexedExecution[] }; errors?: unknown };
  if (body.errors || !body.data?.Execution) {
    throw new Error(`Indexer returned an error: ${JSON.stringify(body.errors ?? body)}`);
  }

  return body.data.Execution.map((execution) => mapExecutionToActivity(execution, options)).filter(
    (entry): entry is Activity => entry !== null,
  );
}
