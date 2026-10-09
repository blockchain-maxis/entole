import { z } from 'zod';

/**
 * Nansen — the corridor-flow bounty. `docs/SCOPE.md`: "Nansen, $5,000,
 * corridor flow intelligence". What a person sees from this is one plain line
 * about how money is moving through the corridor they are about to use. It
 * never decides or blocks anything; it is information beside a payment, not a
 * gate in front of one.
 *
 * **Unconfirmed**: the endpoint path and the response field names below are the
 * shape Nansen's public API docs describe for smart-money net flow, but this
 * environment could not exercise them against a live key. Rather than guess
 * silently, they are isolated in the two constants below and every response is
 * Zod-validated, so a mismatch fails loudly ("unexpected response") instead of
 * rendering a wrong number. Gated off exactly like Agora and Aurora: no
 * `NANSEN_API_KEY` means every call throws "not configured".
 *
 * Server-only: the key is a real secret. Call it from an API route, never from
 * a client component or the phone bundle.
 */

export const NANSEN_DEFAULT_API_BASE = 'https://api.nansen.ai/api/v1';
export const NANSEN_NETFLOW_PATH = '/smart-money/netflow';

export type NansenConfig = {
  apiKey: string;
  apiBase?: string;
  netflowPath?: string;
};

/** One row of net flow for a token over the last 24 hours, in US dollars. */
const flowRowSchema = z.object({
  token_symbol: z.string().min(1),
  net_flow_24h_usd: z.number(),
});

const flowResponseSchema = z.object({ data: z.array(flowRowSchema) });

export type CorridorFlow = {
  symbol: string;
  /** Whole US dollars; positive means money moved in, negative out. */
  netFlow24hUsd: number;
};

export type CorridorSummary = {
  flows: CorridorFlow[];
  /** One plain sentence for the screen. Never mentions a chain or a token. */
  headline: string;
};

export class NansenNotConfiguredError extends Error {
  constructor() {
    super('Nansen is not configured: set NANSEN_API_KEY.');
    this.name = 'NansenNotConfiguredError';
  }
}

/** The settlement-side flows for the Monad corridor, largest movers first. */
export async function fetchCorridorFlows(
  config?: NansenConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CorridorSummary> {
  if (!config?.apiKey) throw new NansenNotConfiguredError();
  const base = config.apiBase ?? NANSEN_DEFAULT_API_BASE;
  const path = config.netflowPath ?? NANSEN_NETFLOW_PATH;

  const response = await fetchImpl(`${base}${path}`, {
    method: 'POST',
    headers: { apiKey: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ chains: ['monad'] }),
  });
  if (!response.ok) throw new Error(`Nansen request failed: ${response.status}`);

  const parsed = flowResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Nansen returned an unexpected response.');

  const flows = parsed.data.data
    .map((row) => ({ symbol: row.token_symbol, netFlow24hUsd: Math.round(row.net_flow_24h_usd) }))
    .sort((a, b) => Math.abs(b.netFlow24hUsd) - Math.abs(a.netFlow24hUsd));
  return { flows, headline: describeFlows(flows) };
}

/** Plain words for the direction of the corridor. */
export function describeFlows(flows: CorridorFlow[]): string {
  const total = flows.reduce((sum, row) => sum + row.netFlow24hUsd, 0);
  if (flows.length === 0 || total === 0) return 'Activity on this route is steady today.';
  return total > 0
    ? 'More money has been moving into this route than out of it today.'
    : 'More money has been moving out of this route than into it today.';
}
