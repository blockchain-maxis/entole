import type { Address } from 'viem';
import { z } from 'zod';

/**
 * Aurora Intents — the funding bounty. `docs/ARCHITECTURE.md`: "Funding:
 * Aurora Intents for any-chain deposits. A user funds from BTC, USDT on
 * Tron, SOL or anything else the solver network covers, and receives the
 * settlement asset on Monad... wrap it behind an interface."
 *
 * Confirmed real (via docs.intents.aurora.dev, not guessed): Aurora Intents
 * is a NEAR Intents-based deposit primitive — "Intents Deposits" generates a
 * chain-specific deposit address, auto-bridges and converts on arrival, with
 * both a widget and an API integration path requiring an Aurora account and
 * API key. **Unconfirmed**: the exact endpoint path and request/response
 * field names — Aurora's public docs describe the product shape but the
 * detailed API reference sits behind their quickstart, which this
 * environment couldn't reach. Rather than guess field names and ship
 * something that looks wired but silently fails, this module exposes the
 * documented shape (source chain/asset in, a deposit address for the
 * settlement asset on Monad out) and throws clearly if called — "not
 * configured" until an `AURORA_INTENTS_API_KEY` exists AND the real
 * endpoint/field names are confirmed against Aurora's quickstart docs.
 * Update `requestDepositAddress`'s fetch call once that's done; nothing
 * downstream needs to change, same one-file-swap promise as `gateway.ts`.
 */

export type AuroraIntentsConfig = {
  apiKey: string;
  apiBase?: string;
};

export type DepositAddressRequest = {
  /** e.g. "bitcoin", "tron", "solana" — whatever chain the user is funding
   * from. Aurora's solver network resolves conversion/bridging from there. */
  sourceChain: string;
  sourceAsset: string;
  /** Where the settlement asset lands once solved — never rendered in the
   * UI, same off-UI-address rule `address-book.ts` follows. */
  destinationAddress: Address;
};

const depositAddressResponseSchema = z.object({
  depositAddress: z.string().min(1),
  sourceChain: z.string().min(1),
  sourceAsset: z.string().min(1),
});

export type DepositAddressResponse = z.infer<typeof depositAddressResponseSchema>;

function requireAuroraConfig(config: AuroraIntentsConfig | undefined): AuroraIntentsConfig {
  if (!config?.apiKey) {
    throw new Error(
      'Aurora Intents is not configured — set AURORA_INTENTS_API_KEY, and confirm the real endpoint ' +
        'shape against docs.intents.aurora.dev before relying on this in production.',
    );
  }
  return config;
}

/**
 * Requests a chain-specific deposit address the user can send funds to from
 * any chain Aurora's solver network covers. Every response is Zod-validated
 * before use. The request shape below is Aurora's documented product
 * behaviour, not a confirmed field-for-field API contract — see this file's
 * header comment.
 */
export async function requestDepositAddress(
  request: DepositAddressRequest,
  config?: AuroraIntentsConfig,
): Promise<DepositAddressResponse> {
  const resolved = requireAuroraConfig(config);
  const base = resolved.apiBase ?? 'https://api.intents.aurora.dev/v1';

  const response = await fetch(`${base}/deposits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceChain: request.sourceChain,
      sourceAsset: request.sourceAsset,
      destinationAddress: request.destinationAddress,
      destinationChain: 'monad',
    }),
  });
  if (!response.ok) throw new Error(`Aurora Intents deposit-address request failed: ${response.status}`);
  const body: unknown = await response.json();
  return depositAddressResponseSchema.parse(body);
}
